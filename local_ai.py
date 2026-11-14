"""
Bordvakts lokala AI. Körs helt på datorn: inga bilder skickas någonstans
och det kostar inget per analys.

Små modeller (Apache 2.0-licens):
- YOLOX-Tiny (standard, 20 MB): hittar personer, glas, koppar, flaskor, skålar/tallrikar och mat.
  Kan bytas med AI_MODEL=nano (minst RAM) eller AI_MODEL=s (noggrannast).
- RTMO-S (40 MB): kroppshållning, för att se om en gäst räcker upp handen.
  Laddas bara när det sitter gäster vid något bord och släpps när matsalen är tom.
- YOLOX-S används för planritning från foto. Den laddas bara under analysen.

Så blir AI:n smartare med tiden:
- Gäst eller personal: kroppsmodellen ser om en person sitter eller står.
  Den som står vid bordet (oftast personal) räknas inte som gäst, och en
  stående persons uppräckta hand ger inget larm.
- Rent bord: AI:n lär sig hur varje bord ser ut när det är rent och dukat,
  och lär om varje gång personalen klarmarkerar en avdukning. Då syns smutsiga
  bord och serverad mat även när modellen inte känner igen föremålen.
- Beställningar: när appens beställningar används vet AI:n exakt när maten
  serverades och räknar väntetiden från beställningen.
- Folk som går förbi startar ingen sittning: gästerna måste sitta en stund först.

Snabbhet och RAM:
- Bara bordens rutor analyseras, inte hela bilden.
- Bord där inget har rört sig sedan förra bilden analyseras inte om.

Modellerna ser bara föremål och kroppsställning. Ingen ansiktsigenkänning görs
och ingenting sparas.

Bordets status räknas sedan ut av regler med "minne" per sittning:
  ingen gäst, inget kvar på bordet          -> AVAILABLE
  ingen gäst, tallrikar/glas kvar           -> NEEDS_CLEANING
  gäst räcker upp handen                    -> NEEDS_ATTENTION
  gäster utan mat längre än FOOD_WAIT_MIN   -> AWAITING_FOOD
  mat har serverats och sedan plockats bort -> DESSERT_OPPORTUNITY
  annars med gäster                         -> OCCUPIED
  gäst tappar glas, tallrik eller bestick,
  eller välter ett glas                     -> EMERGENCY (Akut läge / SOS, se AccidentWatch).
                                               Ligger kvar tills personalen trycker Klar.
"""

import base64
import gc
import json
import os
import subprocess
import sys
import threading
import time
import urllib.request
import zipfile
from collections import deque
from dataclasses import dataclass
from statistics import median

import cv2
import numpy as np
import onnxruntime as ort

MODEL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")
_YOLOX = "https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/"
MODELS = {
    "yolox_nano.onnx": _YOLOX + "yolox_nano.onnx",
    "yolox_tiny.onnx": _YOLOX + "yolox_tiny.onnx",
    "yolox_s.onnx": _YOLOX + "yolox_s.onnx",
    "rtmo_s.onnx": "https://download.openmmlab.com/mmpose/v1/projects/rtmo/onnx_sdk/"
                   "rtmo-s_8xb32-600e_body7-640x640-dac2bf74_20231211.zip",
}
# Inställningar (kan ändras i .env)
AI_THREADS = int(os.environ.get("AI_THREADS", "2"))
# Grafikkretsen/AI-kretsen (Apple CoreML) räknar 2–3 gånger snabbare än processorn
# med samma svar. AI_ACCEL=off tvingar processorn.
_ACCEL_ON = os.environ.get("AI_ACCEL", "auto").strip().lower() not in ("off", "0", "false", "nej", "cpu")
ACCEL_PROVIDERS = [p for p in ("CoreMLExecutionProvider",) if _ACCEL_ON and p in ort.get_available_providers()]
# auto: den noggranna modellen (s) när det finns AI-krets, annars tiny
AI_MODEL = os.environ.get("AI_MODEL", "auto").strip().lower()
if AI_MODEL not in ("nano", "tiny", "s"):
    AI_MODEL = "s" if ACCEL_PROVIDERS else "tiny"
HAND_DETECTION = os.environ.get("HAND_DETECTION", "on").strip().lower() not in ("off", "0", "false", "nej")
POSE_IDLE_SEC = 300      # släpp handmodellen efter 5 min utan gäster
MOTION_THRESHOLD = 3.0   # hur mycket bordets ruta måste ändras för att analyseras om (0–255)
MAX_SKIP_SEC = 15        # analysera ändå minst så här ofta
FOOD_WAIT_MIN = float(os.environ.get("FOOD_WAIT_MIN", "15"))       # minuter utan mat -> "väntar på mat"
DESSERT_DELAY_SEC = float(os.environ.get("DESSERT_DELAY_SEC", "60"))  # tallrikar bortplockade så länge -> dessertläge
EMPTY_GRACE_SEC = float(os.environ.get("EMPTY_GRACE_SEC", "60"))    # så länge bordet får vara tomt innan sittningen räknas som slut
SESSION_START_SEC = float(os.environ.get("SESSION_START_SEC", "15"))  # gäster måste sitta så länge innan en sittning startar
MEAL_MIN_SEC = 20 * 60   # minsta tid att äta när kameran inte ser tallrikarna (maten känd från beställningen)
CLUTTER_DIRTY = 0.10     # så stor del av bordet får skilja sig från "rent bord" innan det räknas som smutsigt
CLUTTER_FOOD = 0.14      # så mycket mer som måste stå på bordet för att räknas som serverad mat
HISTORY_SEC = 5          # bordets status jämnas ut över så här många sekunders analyser
RAISE_SEC = 2.0          # handen ska synas uppräckt i minst halva tiden av de senaste så här många sekunderna
RAISE_SEC_CAREFUL = 4.0  # vid bord där handen ofta larmat fel: dubbelt så länge, och i 3/4 av tiden
CAREFUL_MIN_FALSE = 2    # så många Falsklarm på Vill ha hjälp (14 dagar) innan bordet blir försiktigt
RELEARN_WINDOW_SEC = 180  # efter "avdukat" från personalen: lär in bordet som rent inom så här lång tid

# Akut läge (SOS): en gäst har tappat ett glas eller en tallrik
SOS_DETECTION = os.environ.get("SOS_DETECTION", "on").strip().lower() not in ("off", "0", "false", "nej")
SOS_SETTLED_SEC = (3, 12)  # föremål som stått på bordet mellan 3 och 12 sekunder bakåt "stod där"
SOS_REACT_SEC = 6          # gästen ska reagera (resa sig, böja sig ned) inom så här många sekunder
SOS_COOLDOWN_SEC = 90      # efter "Klar" från personalen: inget nytt SOS medan de torkar upp
EMERGENCY = "EMERGENCY"

# Väntar på notan: gästerna har ätit klart och vill troligen betala
WANTS_BILL = "WANTS_BILL"
BILL_DELAY_MIN = float(os.environ.get("BILL_DELAY_MIN", "7"))  # minuter efter avplockning utan ny beställning
BILL_MIN_SAMPLES = 10    # så många sittningar innan restaurangens egen tid till notan används
BILL_LEARN_LIMITS = (3.0, 20.0)  # den inlärda tiden hålls mellan 3 och 20 minuter
DESSERT_MIN_SESSIONS = 12  # så många sittningar (per bord eller tid på dagen) innan dessert kan stängas av där
DESSERT_MIN_RATE = 0.10    # färre än så här ofta beställer något efter huvudrätten: föreslå ingen dessert
SESSION_GAP_MIN = 150      # beställningar vid samma bord med längre paus än så = olika sittningar
RUSH_SHARE = 0.7           # så stor del av borden med gäster = rusning
RUSH_MIN_TABLES = 3        # och minst så många bord
RUSH_EARLIER_MIN = 3.0     # under rusning larmar Väntar på mat så här många minuter tidigare
MIN_SESSION_SEC = 180  # kortare än 3 min räknas inte som en sittning (t.ex. någon som tittar in)
BILL_EARLY_MIN = 2.0  # tidigast så här många minuter efter avplockning om gästerna gör sig redo att gå

# Lägsta säkerhet per sorts föremål. Personer kräver mer (färre falsklarm),
# glas och tallrikar är små och syns sämre, så där räcker mindre.
MIN_SCORE_PERSON = 0.45
MIN_SCORE_TABLEWARE = 0.28

# COCO-klasser som modellen känner igen
PERSON = 0
DRINKS = {39, 40, 41}  # flaska, vinglas, kopp
DISHES = {45}          # skål (tallrikar hamnar ofta här)
CUTLERY = {42, 43, 44}  # gaffel, kniv, sked
BAGS = {24, 26, 28}    # ryggsäck, handväska, resväska
FOOD = set(range(46, 56))  # banan, äpple, smörgås, apelsin, broccoli, morot, korv, pizza, munk, tårta
DINING_TABLE, CHAIR, COUCH, POTTED_PLANT, TV = 60, 56, 57, 58, 62
BENCH, CLOCK, VASE = 13, 74, 75
KITCHEN_HINTS = {68, 69, 71, 72}  # mikro, ugn, diskho, kylskåp

# Kroppspunkter (COCO-ordning)
NOSE, L_SHOULDER, R_SHOULDER, L_WRIST, R_WRIST = 0, 5, 6, 9, 10
L_HIP, R_HIP, L_KNEE, R_KNEE = 11, 12, 13, 14


# --------------------------------------------------------------- Modeller

def ensure_model(name: str) -> str:
    """Laddar ner modellen första gången den behövs."""
    path = os.path.join(MODEL_DIR, name)
    if os.path.exists(path):
        return path
    os.makedirs(MODEL_DIR, exist_ok=True)
    url = MODELS[name]
    print(f"Laddar ner AI-modellen {name} (engångs, ca 40 MB)...")
    tmp = path + ".part"
    urllib.request.urlretrieve(url, tmp)
    if url.endswith(".zip"):
        with zipfile.ZipFile(tmp) as z, open(path, "wb") as out:
            out.write(z.read("end2end.onnx"))
        os.remove(tmp)
    else:
        os.replace(tmp, path)
    return path


def letterbox(img: np.ndarray, size: int):
    """Skalar bilden till size x size utan att förvränga den (grå kant fyller ut)."""
    ratio = min(size / img.shape[0], size / img.shape[1])
    resized = cv2.resize(img, (max(1, int(img.shape[1] * ratio)), max(1, int(img.shape[0] * ratio))),
                         interpolation=cv2.INTER_AREA if ratio < 1 else cv2.INTER_LINEAR)
    padded = np.full((size, size, 3), 114, dtype=np.uint8)
    padded[: resized.shape[0], : resized.shape[1]] = resized
    tensor = padded.transpose(2, 0, 1)[None].astype(np.float32)
    return tensor, ratio


def session(name: str, accelerate: bool = True) -> ort.InferenceSession:
    options = ort.SessionOptions()
    options.intra_op_num_threads = AI_THREADS  # lämna kärnor över till video och webbserver
    options.inter_op_num_threads = 1
    options.log_severity_level = 3
    path = ensure_model(name)
    if accelerate and ACCEL_PROVIDERS:
        try:
            return ort.InferenceSession(path, options, providers=ACCEL_PROVIDERS + ["CPUExecutionProvider"])
        except Exception as e:  # AI-kretsen gick inte att använda: processorn fungerar alltid
            print(f"AI-kretsen kunde inte användas ({e}). Använder processorn.")
    return ort.InferenceSession(path, options, providers=["CPUExecutionProvider"])


@dataclass
class Detection:
    cls: int
    score: float
    box: tuple  # x1, y1, x2, y2 i bildens pixlar


class ObjectDetector:
    def __init__(self, variant: str = AI_MODEL):
        self.session = session(f"yolox_{variant}.onnx")
        inp = self.session.get_inputs()[0]
        self.input = inp.name
        self.size = int(inp.shape[2])  # 416 för nano/tiny, 640 för s
        grids, strides = [], []
        for stride in (8, 16, 32):
            size = self.size // stride
            xv, yv = np.meshgrid(np.arange(size), np.arange(size))
            grids.append(np.stack((xv, yv), 2).reshape(-1, 2))
            strides.append(np.full((size * size, 1), stride))
        self.grids = np.concatenate(grids)
        self.strides = np.concatenate(strides)

    def __call__(self, img: np.ndarray, score_thr: float = 0.35) -> list[Detection]:
        tensor, ratio = letterbox(img, self.size)
        out = self.session.run(None, {self.input: tensor})[0][0]
        xy = (out[:, :2] + self.grids) * self.strides
        wh = np.exp(out[:, 2:4]) * self.strides
        class_scores = out[:, 4:5] * out[:, 5:]
        cls = class_scores.argmax(1)
        score = class_scores.max(1)
        keep = score > score_thr
        if not keep.any():
            return []
        xy, wh, cls, score = xy[keep], wh[keep], cls[keep], score[keep]
        boxes = np.concatenate([xy - wh / 2, wh], 1) / ratio  # x, y, w, h
        idx = cv2.dnn.NMSBoxesBatched(boxes.tolist(), score.tolist(), cls.tolist(), score_thr, 0.45)
        result = []
        for i in np.array(idx).flatten():
            x, y, w, h = boxes[i]
            result.append(Detection(int(cls[i]), float(score[i]), (float(x), float(y), float(x + w), float(y + h))))
        return result


class PoseDetector:
    def __init__(self):
        self.session = session("rtmo_s.onnx", accelerate=False)  # ingen vinst med AI-kretsen
        self.input = self.session.get_inputs()[0].name
        self.size = int(self.session.get_inputs()[0].shape[2])

    def __call__(self, img: np.ndarray, score_thr: float = 0.5) -> list[np.ndarray]:
        """Returnerar en (17, 3)-array per person: x, y, säkerhet."""
        tensor, ratio = letterbox(img, self.size)
        dets, keypoints = self.session.run(None, {self.input: tensor})
        boxes, scores = dets[0, :, :4], dets[0, :, 4]
        keep = scores > score_thr
        if not keep.any():
            return []
        boxes, scores, keypoints = boxes[keep], scores[keep], keypoints[0][keep]
        xywh = np.concatenate([boxes[:, :2], boxes[:, 2:] - boxes[:, :2]], 1)
        idx = cv2.dnn.NMSBoxes(xywh.tolist(), scores.tolist(), score_thr, 0.45)
        result = []
        for i in np.array(idx).flatten():
            kp = keypoints[i].copy()
            kp[:, :2] /= ratio
            result.append(kp)
        return result


def hand_raised(kp: np.ndarray, conf: float = 0.3) -> bool:
    """En hand ovanför näsan (eller tydligt ovanför axlarna) = gästen vill ha hjälp."""
    for wrist in (L_WRIST, R_WRIST):
        if kp[wrist, 2] < conf:
            continue
        if kp[NOSE, 2] >= conf and kp[wrist, 1] < kp[NOSE, 1]:
            return True
        if kp[L_SHOULDER, 2] >= conf and kp[R_SHOULDER, 2] >= conf:
            shoulder_y = min(kp[L_SHOULDER, 1], kp[R_SHOULDER, 1])
            shoulder_w = abs(kp[L_SHOULDER, 0] - kp[R_SHOULDER, 0])
            if kp[wrist, 1] < shoulder_y - 0.6 * shoulder_w:
                return True
    return False


def bending_down(kp: np.ndarray, conf: float = 0.3) -> bool:
    """Huvudet är nere i höjd med axlarna eller lägre = personen böjer sig ned mot golvet."""
    if kp[NOSE, 2] < conf or kp[L_SHOULDER, 2] < conf or kp[R_SHOULDER, 2] < conf:
        return False
    shoulder_y = (kp[L_SHOULDER, 1] + kp[R_SHOULDER, 1]) / 2
    shoulder_w = abs(kp[L_SHOULDER, 0] - kp[R_SHOULDER, 0])
    return kp[NOSE, 1] > shoulder_y + 0.15 * shoulder_w


def posture(kp: np.ndarray, conf: float = 0.3) -> str | None:
    """'standing', 'seated' eller None (syns inte tydligt).
    Den som står vid bordet är oftast personal (eller på väg därifrån),
    gäster sitter. Sittande: låren är nästan vågräta, så knäna är i höjd med höfterna."""
    def mean_y(*idx):
        pts = [kp[i, 1] for i in idx if kp[i, 2] >= conf]
        return sum(pts) / len(pts) if pts else None

    shoulders, hips, knees = mean_y(L_SHOULDER, R_SHOULDER), mean_y(L_HIP, R_HIP), mean_y(L_KNEE, R_KNEE)
    if shoulders is None or hips is None or knees is None:
        return None  # knäna syns ofta inte bakom bordet
    torso = hips - shoulders
    if torso < 8:
        return None
    thigh = knees - hips
    if thigh > 0.65 * torso:
        return "standing"
    if thigh < 0.35 * torso:
        return "seated"
    return None


def person_center(kp: np.ndarray, conf: float = 0.3):
    """Var personen är: höfterna om de syns, annars medel av synliga punkter."""
    hips = kp[[L_HIP, R_HIP]]
    hips = hips[hips[:, 2] >= conf]
    pts = hips if len(hips) else kp[kp[:, 2] >= conf]
    if len(pts) == 0:
        return None
    return float(pts[:, 0].mean()), float(pts[:, 1].mean())


# ------------------------------------------------------- Bordsanalys

@dataclass
class Observation:
    persons: int
    drinks: int
    dishes: int  # tallrikar/skålar + mat
    hand_raised: bool
    standing: int = 0          # personer som står (troligen personal)
    clutter: float | None = None  # hur mycket bordet skiljer sig från rent bord (0–1)
    people: tuple = ()         # personernas rutor i hela bilden (för att se vilket bord de sitter vid)
    seen_persons: int = 0      # personer modellen såg i rutan, innan grannborden räknats bort
    items: tuple = ()          # glas och tallrikar på bordet (rutor i hela bilden)
    floor_items: tuple = ()    # glas och tallrikar strax nedanför bordskanten (troligen tappade)
    bending: bool = False      # en gäst böjer sig ned mot golvet
    bags: int = 0              # väskor i bild vid bordet (plockas fram när gästerna ska gå)


@dataclass
class OrderInfo:
    """Vad beställningarna i appen säger om bordet (tider i sekunder sedan 1970)."""
    waiting_since: float | None = None  # äldsta beställning som inte är serverad
    served_at: float | None = None      # senast serverade beställning
    orders: tuple = ()                  # (skapad, status) för bordets beställningar
    food_deadline: float | None = None  # när maten borde ha kommit, enligt köket (se food_deadline)


# ------------------------------------------------------------ Kökets tider
# Väntar på mat räknas mot hur lång tid rätterna brukar ta i just den här restaurangens kök,
# inte en fast tid för allt: en sallad är sen efter 11 minuter, en gryta först efter 50.

PREP_MIN_SAMPLES = 3     # så många gånger en rätt måste ha lagats innan tiden används (som webbappen)
PREP_MAX_MIN = 180       # längre än så: beställningen glömdes att klarmarkeras, räknas inte
FOOD_GRACE_MIN = 5.0     # minsta marginal innan maten räknas som sen
FOOD_GRACE_SHARE = 0.25  # eller en fjärdedel av rättens tid, om det är mer


def _dish(name) -> str:
    return name.strip().lower() if isinstance(name, str) else ""


def _ts(value) -> float | None:
    if not isinstance(value, str) or not value:
        return None
    from datetime import datetime

    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def learn_prep_times(rows: list[dict]) -> dict[str, float]:
    """Minuter från beställning till klar i köket (median) per rätt, i gemener.
    rows: beställningar med items, created_at och ready_at."""
    times: dict[str, list[float]] = {}
    for row in rows:
        created, ready = _ts(row.get("created_at")), _ts(row.get("ready_at"))
        items = row.get("items")
        if created is None or ready is None or not isinstance(items, list):
            continue
        minutes = (ready - created) / 60
        if minutes <= 0 or minutes > PREP_MAX_MIN:
            continue
        for item in items:
            name = _dish(item.get("name")) if isinstance(item, dict) else ""
            if name:
                times.setdefault(name, []).append(minutes)
    return {name: median(list_) for name, list_ in times.items() if len(list_) >= PREP_MIN_SAMPLES}


def food_deadline(waiting: list[tuple[float, list]], prep: dict[str, float]) -> float | None:
    """När maten senast borde ha kommit till bordet. waiting: (skapad, rättnamn) för
    beställningar som inte är klara. Den rätt som tar längst tid i en beställning räknas;
    rätter utan historik får FOOD_WAIT_MIN. Den beställning som blir sen först avgör."""
    deadlines = []
    for created, names in waiting:
        known = [prep[_dish(n)] for n in names if _dish(n) in prep]
        if known:
            slowest = max(known)
            minutes = slowest + max(FOOD_GRACE_MIN, slowest * FOOD_GRACE_SHARE)
        else:
            minutes = FOOD_WAIT_MIN
        deadlines.append(created + minutes * 60)
    return min(deadlines) if deadlines else None


@dataclass
class Alarm:
    """Ett Akut läge: varför det larmade och vad som hände."""
    reason: str   # förklaring på svenska (för loggen)
    kind: str     # vad som tappades: drink, food, cutlery eller spill (vält glas)
    trigger: str  # tecknet som avgjorde: floor, tipped, bend eller stand


SOS_REASONS = {
    "floor": "Något syns nedanför bordet.",
    "tipped": "Ett glas har vält på bordet.",
    "bend": "Något försvann från bordet och gästen böjer sig ned.",
    "stand": "Något försvann från bordet och gästen reste sig hastigt.",
}
SOS_TRIGGER_ORDER = ("floor", "tipped", "bend", "stand")  # säkrast först
SOS_KIND_ORDER = ("food", "drink", "cutlery")             # mat är viktigast (köket behöver laga nytt)


class AccidentWatch:
    """Ser om en gäst har tappat ett glas, en tallrik eller bestick, eller vält ett glas.

    Golvet syns sällan i kameran, så tecknen vägs ihop:
    - floor:  något har försvunnit från bordet och syns strax nedanför bordskanten
    - tipped: ett glas som stått upprätt ligger ner (bara med kamera snett ovanifrån)
    - bend:   något har försvunnit och gästen böjer sig ned mot golvet
    - stand:  något har försvunnit och gästen reser sig hastigt (inte för bestick,
              som flyttas hela tiden när man äter)
    Inget larm om personal har kommit fram (då är det en avdukning), eller om en
    person står framför där föremålet stod (då är det bara skymt).

    strict = tecken som gett falsklarm vid just det här bordet. De räcker inte ensamma."""

    def __init__(self):
        self.log: deque[tuple[float, Observation]] = deque(maxlen=120)
        self.quiet_until = 0.0
        self.strict: set[str] = set()

    def reset(self, now: float):
        """Personalen har tagit hand om det: börja om och vänta en stund."""
        self.log.clear()
        self.quiet_until = now + SOS_COOLDOWN_SEC

    def update(self, obs: Observation, now: float) -> Alarm | None:
        self.log.append((now, obs))
        while self.log and now - self.log[0][0] > SOS_SETTLED_SEC[1]:
            self.log.popleft()
        if now < self.quiet_until:
            return None
        before = [o for t, o in self.log if now - t >= SOS_SETTLED_SEC[0]]
        after = [o for t, o in self.log if now - t <= SOS_REACT_SEC]
        latest = [o for _, o in list(self.log)[-2:]]
        if len(before) < 3 or len(latest) < 2:
            return None

        settled = _settled(before)
        gone = [(kind, box) for kind, box in settled if all(_missing(box, o) for o in latest)]
        tipped = [box for kind, box in settled
                  if kind == "drink" and _upright(box) and all(_tipped_near(box, o) for o in latest)]
        if not gone and not tipped:
            return None

        persons_before = max(o.persons for o in before)
        staff_came = any(o.standing for o in before) or any(o.persons > persons_before for o in after)
        signals: set[str] = set()
        if gone and any(o.floor_items for o in after):
            signals.add("floor")
        if not staff_came:  # personal som bär eller plockar undan glas ger inget larm
            if tipped:
                signals.add("tipped")
            if gone and any(o.bending for o in after):
                signals.add("bend")
            seated_before = median(o.persons - o.standing for o in before)
            if any(kind != "cutlery" for kind, _ in gone) and any(o.persons - o.standing < seated_before for o in after):
                signals.add("stand")
        if not signals or (len(signals) < 2 and signals <= self.strict):
            return None

        trigger = next(t for t in SOS_TRIGGER_ORDER if t in signals)
        kinds = {kind for kind, _ in gone}
        kind = "spill" if trigger == "tipped" else next((k for k in SOS_KIND_ORDER if k in kinds), "drink")
        return Alarm(SOS_REASONS[trigger], kind, trigger)


def strict_triggers(rows: list[dict], min_false: int = 2) -> dict[str, set[str]]:
    """Vilka tecken som ska vara försiktiga vid varje bord, från avslutade SOS-uppgifter:
    minst min_false falsklarm och ingen riktig olycka med samma tecken."""
    counts: dict[tuple[str, str], list[int]] = {}
    for row in rows:
        if not row.get("sos_trigger"):
            continue
        c = counts.setdefault((row["table_id"], row["sos_trigger"]), [0, 0])
        c[0 if row.get("false_alarm") else 1] += 1
    result: dict[str, set[str]] = {}
    for (table_id, trigger), (false, real) in counts.items():
        if false >= min_false and real == 0:
            result.setdefault(table_id, set()).add(trigger)
    return result


def careful_hand_tables(rows: list[dict], min_false: int = CAREFUL_MIN_FALSE) -> set[str]:
    """Bord där Vill ha hjälp (uppräckt hand) ska vara försiktigt, från avslutade uppgifter:
    minst min_false Falsklarm och fler Falsklarm än riktiga larm."""
    counts: dict[str, list[int]] = {}
    for row in rows:
        if row.get("type") != "SERVICE" or not row.get("table_id"):
            continue
        c = counts.setdefault(row["table_id"], [0, 0])
        c[0 if row.get("false_alarm") else 1] += 1
    return {table for table, (false, real) in counts.items() if false >= min_false and false > real}


def learn_bill_delay(rows: list[dict]) -> float | None:
    """Minuter efter avplockning tills gästerna vill ha notan, från restaurangens sittningar
    (cleared_at, bill_at). Medianen minus en minut (personalen behöver hinna fram), inom
    BILL_LEARN_LIMITS. None tills det finns BILL_MIN_SAMPLES sittningar."""
    delays = []
    for row in rows:
        cleared, bill = _ts(row.get("cleared_at")), _ts(row.get("bill_at"))
        if cleared is None or bill is None:
            continue
        minutes = (bill - cleared) / 60
        if 0 < minutes <= 90:
            delays.append(minutes)
    if len(delays) < BILL_MIN_SAMPLES:
        return None
    low, high = BILL_LEARN_LIMITS
    return min(high, max(low, median(delays) - 1))


def learn_dessert(rows: list[dict]) -> tuple[set[str], set[int]]:
    """Bord och tider på dagen (tvåtimmarsperioder, hour // 2 i lokal tid) där gästerna nästan
    aldrig beställer något mer efter huvudrätten. rows: beställningar (table_id, created_at, served_at)."""
    by_table: dict[str, list[tuple[float, float | None]]] = {}
    for row in rows:
        created = _ts(row.get("created_at"))
        if created is None or not row.get("table_id") or row.get("status") == "CANCELLED":
            continue
        by_table.setdefault(row["table_id"], []).append((created, _ts(row.get("served_at"))))

    tables: dict[str, list[int]] = {}   # bord -> [sittningar, med något efter maten]
    hours: dict[int, list[int]] = {}    # tvåtimmarsperiod -> samma
    for table_id, orders in by_table.items():
        orders.sort()
        sittings: list[list[tuple[float, float | None]]] = []
        for o in orders:
            if sittings and o[0] - sittings[-1][-1][0] <= SESSION_GAP_MIN * 60:
                sittings[-1].append(o)
            else:
                sittings.append([o])
        for sitting in sittings:
            served = [s for _, s in sitting if s is not None]
            if not served:
                continue  # maten kom aldrig fram (eller klarmarkerades inte): säger inget
            first_served = min(served)
            more = any(created > first_served + 60 for created, _ in sitting)
            bucket = time.localtime(sitting[0][0]).tm_hour // 2
            for store, key in ((tables, table_id), (hours, bucket)):
                c = store.setdefault(key, [0, 0])
                c[0] += 1
                c[1] += more

    def low(store):
        return {k for k, (n, more) in store.items() if n >= DESSERT_MIN_SESSIONS and more / n < DESSERT_MIN_RATE}

    return low(tables), low(hours)


def _settled(observations: list[Observation]) -> list[tuple]:
    """Glas, tallrikar och bestick som syntes på samma plats i de flesta av observationerna."""
    result = []
    for kind, box in observations[-1].items:
        seen = sum(any(_iou(box, other) > 0.3 for _, other in o.items) for o in observations)
        if seen >= 0.6 * len(observations):
            result.append((kind, box))
    return result


def _missing(box, obs: Observation) -> bool:
    """Är föremålet borta i den här observationen? Skymt av en person räknas inte som borta."""
    if any(_iou(box, other) > 0.3 for _, other in obs.items):
        return False
    return not any(_overlap_ratio(box, person) > 0.5 for person in obs.people)


def _upright(box) -> bool:
    """Ett glas som står syns högre än det är brett (kameran sitter snett ovanför)."""
    return box[3] - box[1] >= 1.25 * (box[2] - box[0])


def _tipped_near(box, obs: Observation) -> bool:
    """Ligger glaset ner där det nyss stod upprätt?"""
    near = _expand(box, 0.5)
    lying = [b for kind, b in obs.items if kind == "drink" and b[2] - b[0] >= 1.3 * (b[3] - b[1])
             and _overlap_ratio(b, near) > 0.5]
    standing = any(kind == "drink" and _upright(b) and _iou(box, b) > 0.3 for kind, b in obs.items)
    return bool(lying) and not standing


class TableMemory:
    """Minne för ett bord under en sittning, så att t.ex. "väntar på mat"
    och "dessertläge" kan avgöras över tid och inte bara från en bild."""

    def __init__(self):
        self.watch = AccidentWatch()
        self.sos_since: float | None = None  # Akut läge: ligger kvar tills personalen trycker Klar
        self.sos: Alarm | None = None        # vad som hände (None om SOS kom från databasen)
        self.history: deque[Observation] = deque(maxlen=60)
        self.times: deque[float] = deque(maxlen=60)  # när varje analys i history gjordes
        self.session_start: float | None = None
        self.arriving_since: float | None = None
        self.empty_since: float | None = None
        self.base_dishes = 0
        self.base_clutter: float | None = None
        self.clean_drinks: int | None = None  # antal glas på ett dukat, rent bord
        self.served = False
        self.served_at: float | None = None
        self.food_seen = False
        self.cleared_since: float | None = None
        self.dessert_done = False
        self.last_status = "AVAILABLE"
        self.clean_streak = 0  # antal analyser i rad som bordet varit ledigt och rent
        self.relearn_until: float | None = None  # personalen har dukat av: lär in bordet som rent
        self.careful_hand = False  # personalen har tryckt Falsklarm på Vill ha hjälp flera gånger här
        self.bill_delay_min = BILL_DELAY_MIN  # minuter efter avplockning till notan (lärs in per restaurang)
        self.no_dessert = False   # här och nu beställer gästerna nästan aldrig dessert
        self.rush = False         # de flesta borden har gäster: larma tidigare om maten dröjer
        self.cleared_at: float | None = None  # när maten plockades bort under sittningen
        self.bill_at: float | None = None     # när notan kom (personalen tryckte Klar, eller betalt i appen)
        self.peak_guests = 0      # flest sittande gäster under sittningen
        self.cleared_bags = 0     # väskor i bild när maten plockades bort
        self.bill_done = False    # personalen har lämnat notan (eller gästerna har betalat)
        # Avslutade sittningar (start, slut, gäster, avplockad, notan) för statistiken och inlärningen
        self.finished: list[tuple[float, float, int, float | None, float | None]] = []

    def update(self, obs: Observation, now: float, orders: OrderInfo | None = None) -> str:
        status = self._decide(obs, now, orders)
        # Olyckor bevakas bara under en sittning (gäster vid bordet)
        if not SOS_DETECTION or self.session_start is None:
            self.watch.log.clear()
        elif self.sos_since is None:
            alarm = self.watch.update(obs, now)
            if alarm:
                self.sos_since, self.sos = now, alarm
        if self.sos_since is not None:
            status = EMERGENCY
        self.clean_streak = self.clean_streak + 1 if status == "AVAILABLE" else 0
        self.last_status = status
        return status

    def start_emergency(self, now: float):
        """Akut läge sätts utifrån, t.ex. när AI-motorn startar om medan ett SOS väntar."""
        self.sos_since = self.sos_since or now

    def clear_emergency(self, now: float):
        """Personalen har tryckt Klar (eller Falsklarm) på SOS-uppgiften."""
        self.sos_since = self.sos = None
        self.watch.reset(now)

    def _start_session(self, now: float, dishes: float, clutter: float | None):
        self.session_start = now
        self.base_dishes = int(dishes)
        self.base_clutter = clutter
        self.served = False
        self.served_at = None
        self.food_seen = False
        self.cleared_since = None
        self.dessert_done = False
        self.peak_guests = 0
        self.cleared_bags = 0
        self.bill_done = False
        self.cleared_at = None
        self.bill_at = None

    def bill_brought(self, now: float | None = None):
        """Personalen har tryckt Klar på notan: fråga inte igen under sittningen
        (och föreslå inte dessert efter notan)."""
        self.bill_done = self.dessert_done = True
        if self.session_start is not None and self.bill_at is None:
            self.bill_at = now or time.time()

    def _empty_table(self, drinks: float, dishes: float, clutter: float | None) -> str:
        if self.clean_drinks is None:
            self.clean_drinks = int(drinks)
        messy = clutter is not None and clutter > CLUTTER_DIRTY
        if dishes > 0 or drinks > self.clean_drinks or messy:
            return "NEEDS_CLEANING"
        self.clean_drinks = int(drinks)  # bordet är rent: kom ihåg hur det ser ut dukat
        return "AVAILABLE"

    def _decide(self, obs: Observation, now: float, orders: OrderInfo | None) -> str:
        self.history.append(obs)
        self.times.append(now)
        # Bara de senaste sekunderna räknas (men minst 3 analyser), oavsett hur ofta kameran analyseras
        while len(self.history) > 3 and now - self.times[0] > HISTORY_SEC:
            self.history.popleft()
            self.times.popleft()
        guests = median(max(0, o.persons - o.standing) for o in self.history)
        drinks = median(o.drinks for o in self.history)
        dishes = median(o.dishes for o in self.history)
        clutters = [o.clutter for o in self.history if o.clutter is not None]
        clutter = median(clutters) if len(clutters) >= 3 else None
        # Handen ska vara uppe en stund: att klia sig i håret eller rätta till glasögonen ger inget larm
        if self.careful_hand:
            # Bordet har gett falsklarm: handen ska vara uppe längre och nästan hela tiden
            recent = [o.hand_raised for o, t in zip(self.history, self.times) if now - t <= RAISE_SEC_CAREFUL] or [obs.hand_raised]
            raised = sum(recent) >= 4 and sum(recent) * 4 >= len(recent) * 3
        else:
            recent = [o.hand_raised for o, t in zip(self.history, self.times) if now - t <= RAISE_SEC] or [obs.hand_raised]
            raised = sum(recent) >= 2 and sum(recent) * 2 >= len(recent)

        # --- Inga gäster (personal som står vid bordet räknas inte)
        if guests < 1:
            self.arriving_since = None
            if self.session_start is not None:
                self.empty_since = self.empty_since or now
                if now - self.empty_since < EMPTY_GRACE_SEC:
                    return "OCCUPIED"  # t.ex. ett toalettbesök
                if self.empty_since - self.session_start >= MIN_SESSION_SEC:
                    self.finished.append((self.session_start, self.empty_since, max(1, self.peak_guests), self.cleared_at, self.bill_at))
                self.session_start = None  # sittningen är slut
            return self._empty_table(drinks, dishes, clutter)

        # --- Gäster vid bordet
        self.empty_since = None
        if self.session_start is None:
            # Någon som bara går förbi eller stannar till ska inte starta en sittning
            self.arriving_since = self.arriving_since or now
            if now - self.arriving_since < SESSION_START_SEC:
                return self.last_status if self.last_status in ("AVAILABLE", "NEEDS_CLEANING") else "AVAILABLE"
            self._start_session(now, dishes, clutter)
        if self.base_clutter is None:
            self.base_clutter = clutter
        self.peak_guests = max(self.peak_guests, int(guests))

        if raised:
            return "NEEDS_ATTENTION"

        # Beställningarna i appen är säkrare än kameran
        if orders is not None:
            if orders.served_at and orders.served_at >= self.session_start and not self.served:
                self.served, self.served_at = True, orders.served_at
            if orders.waiting_since and self.served_at and orders.waiting_since > self.served_at:
                self.dessert_done = True  # de har beställt mer (dessert/kaffe): inget att föreslå

        more_on_table = (
            clutter is not None and self.base_clutter is not None and clutter - self.base_clutter > CLUTTER_FOOD
        )
        if dishes > self.base_dishes or more_on_table:
            # Mat (eller dessert) står på bordet
            if self.cleared_since is not None and self.food_seen:
                self.dessert_done = True  # nya tallrikar efter avplockning = dessert/kaffe
            self.served = self.food_seen = True
            self.served_at = self.served_at or now
            self.cleared_since = None
            self.bill_done = False  # ny mat (t.ex. dessert): notan är inte lämnad för den
            return "OCCUPIED"

        if not self.served:
            # Köket vet hur lång tid rätterna brukar ta: maten är sen först när den tiden gått
            earlier = RUSH_EARLIER_MIN * 60 if self.rush else 0
            if orders is not None and orders.food_deadline is not None and orders.waiting_since:
                return "AWAITING_FOOD" if now > orders.food_deadline - earlier else "OCCUPIED"
            # Annars räknas väntetiden från beställningen om det finns en, eller från när de satte sig
            waiting_from = max(self.session_start, orders.waiting_since) if orders and orders.waiting_since else self.session_start
            if now - waiting_from > FOOD_WAIT_MIN * 60 - earlier:
                return "AWAITING_FOOD"
            return "OCCUPIED"

        # Maten är serverad enligt beställningen men kameran ser inga tallrikar:
        # ge gästerna tid att äta innan dessert föreslås
        if not self.food_seen and now - (self.served_at or now) < MEAL_MIN_SEC:
            return "OCCUPIED"

        # Maten har serverats och plockats bort
        if self.cleared_since is None:
            self.cleared_since = now
            self.cleared_at = self.cleared_at or now
            self.cleared_bags = int(median(o.bags for o in self.history))
        if self._wants_bill(now, guests, orders):
            return WANTS_BILL
        if not self.dessert_done and not self.no_dessert and now - self.cleared_since > DESSERT_DELAY_SEC:
            return "DESSERT_OPPORTUNITY"
        return "OCCUPIED"

    def _wants_bill(self, now: float, guests: float, orders: OrderInfo | None) -> bool:
        """Gästerna har ätit klart och vill troligen betala.
        - BILL_DELAY_MIN minuter efter avplockning utan ny beställning, eller
        - tidigast BILL_EARLY_MIN minuter efter avplockning om en väska plockas fram
          eller minst hälften av gästerna reser sig."""
        if self.bill_done or self.cleared_since is None:
            return False
        if orders is not None:
            if orders.waiting_since:
                return False  # de har beställt mer
            mine = [status for created, status in orders.orders if created >= self.session_start - 300]
            if mine and all(status == "COMPLETED" for status in mine):
                self.bill_done = self.dessert_done = True  # allt är betalt och avslutat i appen
                self.bill_at = self.bill_at or now
                return False
        waited = now - self.cleared_since
        if waited >= self.bill_delay_min * 60:
            return True
        if waited < BILL_EARLY_MIN * 60:
            return False
        bags = median(o.bags for o in self.history)
        standing = median(o.standing for o in self.history)
        half = (self.peak_guests + 1) // 2
        leaving = self.peak_guests >= 1 and standing >= 1 and self.peak_guests - guests >= half
        return bags > self.cleared_bags or leaving


def _area(box) -> float:
    return max(0.0, box[2] - box[0]) * max(0.0, box[3] - box[1])


def _overlap_ratio(box, region) -> float:
    """Hur stor del av box som ligger inom region (0–1)."""
    x1, y1 = max(box[0], region[0]), max(box[1], region[1])
    x2, y2 = min(box[2], region[2]), min(box[3], region[3])
    inter = _area((x1, y1, x2, y2))
    return inter / _area(box) if _area(box) > 0 else 0.0


def _iou(a, b) -> float:
    x1, y1, x2, y2 = max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])
    inter = _area((x1, y1, x2, y2))
    union = _area(a) + _area(b) - inter
    return inter / union if union > 0 else 0.0


def count_objects(detections: list, classes: set, containers: set = frozenset()) -> int:
    """Räknar föremål utan att räkna samma sak två gånger: modellen kan kalla ett glas
    både "kopp" och "vinglas", och mat som ligger i en skål är samma tallrik."""
    return len(unique_objects(detections, classes, containers))


def unique_objects(detections: list, classes: set, containers: set = frozenset()) -> list:
    """Föremålen i count_objects, ett per sak."""
    kept: list = []
    for d in sorted((d for d in detections if d.cls in classes), key=lambda d: -d.score):
        duplicate = any(
            _iou(d.box, k.box) > 0.5
            or (k.cls in containers and d.cls not in containers and _overlap_ratio(d.box, k.box) > 0.7)
            or (d.cls in containers and k.cls not in containers and _overlap_ratio(k.box, d.box) > 0.7)
            for k in kept
        )
        if not duplicate:
            kept.append(d)
    return kept


def _on_table(box, area, margin: float = 0.08) -> bool:
    """Står föremålet på bordet? Mitten av föremålet ska vara inom bordets ruta (lite marginal)."""
    cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
    mx, my = (area[2] - area[0]) * margin, (area[3] - area[1]) * margin
    return area[0] - mx <= cx <= area[2] + mx and area[1] - my <= cy <= area[3] + my


def _kind(cls: int) -> str:
    """Vad ett föremål är, för Akut läge: dryck, mat eller bestick."""
    return "drink" if cls in DRINKS else "cutlery" if cls in CUTLERY else "food"


def _below_table(box, area) -> bool:
    """Ligger föremålet strax nedanför bordskanten (på golvet framför bordet)?"""
    cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
    return area[0] <= cx <= area[2] and cy > area[3]


def _roi_distance(point, roi) -> float:
    """Hur långt från bordets mitt en punkt är, i bordsstorlekar (under 1 = på bordet)."""
    cx, cy = (roi[0] + roi[2]) / 2, (roi[1] + roi[3]) / 2
    hw, hh = max(1.0, (roi[2] - roi[0]) / 2), max(1.0, (roi[3] - roi[1]) / 2)
    return max(abs(point[0] - cx) / hw, abs(point[1] - cy) / hh)


def belongs_to(point, tid, rois: dict) -> bool:
    """Hör personen till bordet tid? Nej bara om hen tydligt sitter vid ett annat bord:
    mitt i ett annat bords ruta men utanför det här, eller klart närmare det andra bordet."""
    if tid not in rois:
        return True
    mine = _roi_distance(point, rois[tid])
    for other, roi in rois.items():
        if other == tid:
            continue
        theirs = _roi_distance(point, roi)
        if (theirs <= 1 < mine) or theirs < mine - 0.3:
            return False
    return True


# ------------------------------------------------- Ser kameran bordet?
# Regel: AI:n får aldrig gissa. Bordets status räknas bara ut när bordet
# syns tydligt i bilden. Annars blir statusen "Kameran ser inte bordet".

ANCHOR_WIDTH = 320
BLIND_AFTER_SEC = 8   # så länge kontrollen får misslyckas innan ett bekräftat bord räknas som osynligt
CAMERA_BLIND = "CAMERA_BLIND"

ISSUE_NOT_CALIBRATED = "Bordet är inte kalibrerat. Kalibrera det i installationen."
ISSUE_DARK = "Bilden är svart eller övertäckt."
ISSUE_BLURRY = "Bilden är suddig. Kontrollera kamerans fokus och lins."
ISSUE_MISMATCH = "Bordet syns inte där det ska. Kameran kan ha flyttats, eller något skymmer."
ISSUE_UNCONFIRMED = "Bordet kan inte bekräftas än (för mycket skyms)."

# En ORB per tråd: kalibreringen körs i webbserverns tråd samtidigt som analysen
_orb = threading.local()


def _prep_gray(crop: np.ndarray, size: tuple[int, int] | None = None) -> np.ndarray:
    gray = crop if crop.ndim == 2 else cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    if size is None:
        h = max(1, round(gray.shape[0] * ANCHOR_WIDTH / gray.shape[1]))
        size = (ANCHOR_WIDTH, h)
    gray = cv2.resize(gray, size, interpolation=cv2.INTER_AREA)
    # Utjämna ljuset så att lampor och dagsljus inte spelar roll
    return cv2.createCLAHE(clipLimit=2.0, tileGridSize=(4, 4)).apply(gray)


def frame_problem(frame: np.ndarray) -> str | None:
    """Fel på hela bilden: svart/övertäckt eller suddig."""
    small = cv2.cvtColor(cv2.resize(frame, (320, 180), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY)
    if small.mean() < 18 or small.std() < 7:
        return ISSUE_DARK
    if cv2.Laplacian(small, cv2.CV_64F).var() < 12:
        return ISSUE_BLURRY
    return None


def _features(gray: np.ndarray, mask: np.ndarray | None = None):
    orb = getattr(_orb, "orb", None)
    if orb is None:
        orb = _orb.orb = cv2.ORB_create(nfeatures=600, fastThreshold=12)
    return orb.detectAndCompute(gray, mask)


def _edges(gray: np.ndarray) -> np.ndarray:
    e = cv2.Canny(cv2.GaussianBlur(gray, (5, 5), 0), 40, 120)
    return cv2.GaussianBlur(e, (9, 9), 0).astype(np.float32)


def make_anchor(frame: np.ndarray, crop: np.ndarray) -> tuple[str | None, str | None]:
    """Sparar hur bordet ser ut vid kalibreringen. Returnerar (bild som base64, fel)."""
    problem = frame_problem(frame)
    if problem:
        return None, problem
    if crop.size == 0 or min(crop.shape[:2]) < 24:
        return None, "Rutan är för liten. Rita en större ruta runt bordet."
    gray = _prep_gray(crop)
    keypoints, _ = _features(gray)
    edge_density = float((cv2.Canny(gray, 40, 120) > 0).mean())
    if len(keypoints) < 30 and edge_density < 0.03:
        return None, ("För lite att känna igen i rutan. Gör rutan lite större så att stolar "
                      "och golv runt bordet kommer med.")
    ok, png = cv2.imencode(".png", gray)
    return (base64.b64encode(png.tobytes()).decode() if ok else None), (None if ok else "Kunde inte spara bilden.")


def decode_anchor(png_b64: str) -> np.ndarray | None:
    try:
        return cv2.imdecode(np.frombuffer(base64.b64decode(png_b64), np.uint8), cv2.IMREAD_GRAYSCALE)
    except Exception:
        return None


def match_anchor(anchor: np.ndarray, crop: np.ndarray, people: list[tuple]) -> bool | None:
    """True = bordet syns på samma plats som vid kalibreringen. False = det gör det inte.
    None = går inte att avgöra (nästan allt skyms av personer)."""
    h, w = anchor.shape
    now = _prep_gray(crop, (w, h))
    # Personer räknas inte: de skymmer bordet men betyder inte att kameran har flyttats
    mask = np.full((h, w), 255, np.uint8)
    sx, sy = w / crop.shape[1], h / crop.shape[0]
    for x1, y1, x2, y2 in people:
        mask[max(0, int(y1 * sy)):int(np.ceil(y2 * sy)), max(0, int(x1 * sx)):int(np.ceil(x2 * sx))] = 0
    visible_part = float((mask > 0).mean())
    if visible_part < 0.3:
        return None

    # 1. Känn igen samma detaljer (hörn, kanter, mönster) som vid kalibreringen
    kp_a, des_a = _features(anchor, mask)
    kp_n, des_n = _features(now, mask)
    if des_a is not None and des_n is not None and len(kp_a) >= 8 and len(kp_n) >= 8:
        pairs = cv2.BFMatcher(cv2.NORM_HAMMING).knnMatch(des_a, des_n, k=2)
        good = [p[0] for p in pairs if len(p) == 2 and p[0].distance < 0.75 * p[1].distance]
        if len(good) >= 10:
            src = np.float32([kp_a[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
            dst = np.float32([kp_n[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
            H, inliers = cv2.findHomography(src, dst, cv2.RANSAC, 5.0)
            if H is not None and inliers is not None and int(inliers.sum()) >= 8:
                scale = float(np.linalg.det(H[:2, :2]))
                if abs(H[0, 2]) < 0.12 * w and abs(H[1, 2]) < 0.12 * h and 0.75 < scale < 1.33:
                    return True

    # 2. Släta bord med få detaljer: leta efter bordets kanter i bilden.
    #    De måste hittas på samma plats som vid kalibreringen, inte bara "likna".
    ea, en = _edges(anchor), _edges(now)
    hidden = mask == 0
    ea[hidden] = 0
    en[hidden] = 0
    mx, my = int(w * 0.15), int(h * 0.15)
    template = ea[my:h - my, mx:w - mx]
    if template.std() < 1 or en.std() < 1:
        return False
    scores = cv2.matchTemplate(en, template, cv2.TM_CCOEFF_NORMED)
    _, best, _, (bx, by) = cv2.minMaxLoc(scores)
    return best >= 0.45 and abs(bx - mx) <= 0.06 * w and abs(by - my) <= 0.06 * h


class Visibility:
    """Håller koll på om ett bord syns, med lite tålamod så att en servitör
    som går förbi kameran inte ger falsklarm."""

    def __init__(self):
        self.confirmed = False   # har bordet någon gång bekräftats sedan start?
        self.visible = False
        self.failing_since: float | None = None
        self.issue: str | None = ISSUE_UNCONFIRMED

    def update(self, result: bool | None, now: float, issue: str = ISSUE_MISMATCH) -> bool:
        if result is True:
            self.confirmed = self.visible = True
            self.failing_since, self.issue = None, None
        elif result is False:
            self.failing_since = self.failing_since or now
            if not self.confirmed or now - self.failing_since >= BLIND_AFTER_SEC:
                self.visible, self.issue = False, issue
        elif not self.confirmed:  # går inte att avgöra och har aldrig bekräftats
            self.visible, self.issue = False, ISSUE_UNCONFIRMED
        return self.visible


class LocalTableAI:
    """Modellerna laddas först när de behövs, så att AI-motorn startar
    snabbt och inte tar RAM för saker som inte används."""

    def __init__(self):
        print(f"Lokal AI redo (YOLOX-{AI_MODEL}{' på AI-kretsen' if ACCEL_PROVIDERS else ''}"
              f"{' + RTMO för handuppräckning' if HAND_DETECTION else ''}). Modellerna laddas när de behövs.")
        self._load_lock = threading.Lock()
        self._detector: ObjectDetector | None = None
        self._pose: PoseDetector | None = None
        self.guests_seen_at = 0.0
        self.memory: dict[str, TableMemory] = {}
        # Senaste analysen per bord: (miniatyrbild, observation, tid, bordsyta, syns bordet?)
        self.last_seen: dict[str, tuple] = {}
        self.visibility: dict[str, Visibility] = {}
        # Hur varje bord ser ut när det är rent och dukat: (bordets ruta, bild)
        self.clean_ref: dict[str, tuple[tuple, np.ndarray]] = {}
        self.orders: dict[str, OrderInfo] = {}

    def set_orders(self, orders: dict[str, OrderInfo]):
        """Beställningarnas läge per bord (uppdateras av AI.py var 5:e sekund)."""
        self.orders = orders

    def forget_table(self, table_id: str):
        """Bordet har kalibrerats om: glöm allt som jämfördes mot den gamla bilden."""
        for store in (self.last_seen, self.visibility, self.clean_ref):
            store.pop(table_id, None)

    def start_emergency(self, table_id: str):
        """Ett SOS väntar på personalen (t.ex. efter omstart av AI-motorn)."""
        self.memory.setdefault(table_id, TableMemory()).start_emergency(time.time())

    def emergency(self, table_id: str) -> Alarm | None:
        """Vad som hände vid bordets pågående Akut läge (None om okänt)."""
        memory = self.memory.get(table_id)
        return memory.sos if memory else None

    def update_rush(self):
        """Rusning: de flesta borden har gäster. Då larmar Väntar på mat tidigare."""
        seated = sum(m.session_start is not None for m in self.memory.values())
        total = len(self.memory)
        rush = seated >= RUSH_MIN_TABLES and total > 0 and seated / total >= RUSH_SHARE
        for memory in self.memory.values():
            memory.rush = rush

    def set_bill_delay(self, minutes: float | None):
        """Restaurangens egen tid från avplockning till notan (None = BILL_DELAY_MIN)."""
        self.bill_delay = minutes or BILL_DELAY_MIN
        for memory in self.memory.values():
            memory.bill_delay_min = self.bill_delay

    def set_dessert(self, low_tables: set[str], low_hours: set[int]):
        """Bord och tider på dagen där gästerna nästan aldrig beställer dessert."""
        self.low_dessert = (low_tables, low_hours)

    def _apply_learning(self, tid: str, memory: TableMemory, now: float):
        memory.bill_delay_min = getattr(self, "bill_delay", BILL_DELAY_MIN)
        low_tables, low_hours = getattr(self, "low_dessert", (set(), set()))
        memory.no_dessert = tid in low_tables or time.localtime(now).tm_hour // 2 in low_hours

    def set_careful_hands(self, tables: set[str]):
        """Bord där personalen ofta tryckt Falsklarm på Vill ha hjälp (från AI.py)."""
        for table_id in set(self.memory) | tables:
            self.memory.setdefault(table_id, TableMemory()).careful_hand = table_id in tables

    def set_strict(self, strict: dict[str, set[str]]):
        """Tecken som gett falsklarm per bord (från personalens Falsklarm-knapp)."""
        for table_id in set(self.memory) | set(strict):
            self.memory.setdefault(table_id, TableMemory()).watch.strict = strict.get(table_id, set())

    def drain_sessions(self) -> list[tuple[str, float, float, int, float | None, float | None]]:
        """Avslutade sittningar sedan förra anropet: (bord-id, start, slut, gäster, avplockad, notan)."""
        out = []
        for table_id, memory in self.memory.items():
            out.extend((table_id, *s) for s in memory.finished)
            memory.finished.clear()
        return out

    def bill_brought(self, table_id: str):
        """Personalen har lämnat notan till bordet."""
        if table_id in self.memory:
            self.memory[table_id].bill_brought()

    def clear_emergency(self, table_id: str):
        """Personalen har tryckt Klar eller Falsklarm på SOS-uppgiften för bordet."""
        memory = self.memory.get(table_id)
        if memory is not None:
            memory.clear_emergency(time.time())
            print("SOS avslutat av personalen.")

    def mark_clean(self, table_id: str):
        """Personalen har klarmarkerat avdukningen: nästa gång ingen står vid
        bordet lär sig AI:n att så här ser bordet ut när det är rent."""
        self.memory.setdefault(table_id, TableMemory()).relearn_until = time.time() + RELEARN_WINDOW_SEC

    @property
    def detector(self) -> ObjectDetector:
        with self._load_lock:
            if self._detector is None:
                self._detector = ObjectDetector()
            return self._detector

    @property
    def pose(self) -> PoseDetector:
        with self._load_lock:
            if self._pose is None:
                print("Gäster syns: laddar handmodellen (RTMO).")
                self._pose = PoseDetector()
            return self._pose

    def _release_pose_if_idle(self, now: float):
        if self._pose is not None and now - self.guests_seen_at > POSE_IDLE_SEC:
            with self._load_lock:
                self._pose = None
            gc.collect()
            print("Inga gäster på en stund: handmodellen är släppt från minnet.")

    @staticmethod
    def table_box(frame: np.ndarray, roi) -> tuple[int, int, int, int]:
        """Bordets ruta i pixlar, lite utökad så att stolarna kommer med."""
        h, w = frame.shape[:2]
        x1, y1, x2, y2 = roi
        mx, my = (x2 - x1) * 0.1, (y2 - y1) * 0.1
        return (max(0, int((x1 - mx) * w)), max(0, int((y1 - my) * h)),
                min(w, int((x2 + mx) * w)), min(h, int((y2 + my) * h)))

    def observe(self, crop: np.ndarray, offset: tuple[int, int] = (0, 0),
                area: tuple | None = None) -> tuple[Observation, list[tuple]]:
        """Räknar gäster, glas och tallrikar. Returnerar också personernas rutor
        (de räknas inte med när bordsytan jämförs med ett rent bord).
        area = själva bordet i rutans pixlar: glas och tallrikar utanför (t.ex. på grannbordet) räknas inte."""
        if crop.size == 0:
            return Observation(0, 0, 0, False), []
        crop_area = crop.shape[0] * crop.shape[1]
        detections = self.detector(crop, score_thr=MIN_SCORE_TABLEWARE)
        people = [d.box for d in detections
                  if d.cls == PERSON and d.score >= MIN_SCORE_PERSON and _area(d.box) > 0.02 * crop_area]
        bags = sum(1 for d in detections if d.cls in BAGS and d.score >= 0.35)
        floor = []
        if area is not None:
            floor = [(_kind(d.cls), d.box) for d in detections
                     if d.cls in DRINKS | DISHES | CUTLERY and _below_table(d.box, area)
                     and not any(_overlap_ratio(d.box, p) > 0.5 for p in people)]  # i en gästs hand eller knä
            detections = [d for d in detections if d.cls == PERSON or _on_table(d.box, area)]
        drinks = unique_objects(detections, DRINKS)
        dishes = unique_objects(detections, DISHES | FOOD, containers=DISHES)
        cutlery = unique_objects(detections, CUTLERY)
        ox, oy = offset

        def shift(box):
            return box[0] + ox, box[1] + oy, box[2] + ox, box[3] + oy

        items = tuple((_kind(d.cls), shift(d.box)) for d in drinks + dishes + cutlery)
        return Observation(len(people), len(drinks), len(dishes), False, people=tuple(shift(p) for p in people),
                           seen_persons=len(people), items=items,
                           floor_items=tuple((kind, shift(box)) for kind, box in floor), bags=bags), people

    def people_at_tables(self, frame: np.ndarray, boxes: dict[str, tuple],
                         rois: dict[str, tuple] | None = None) -> dict[str, tuple[int, bool]]:
        """Kör kroppsmodellen EN gång över alla bord med folk (i stället för en gång per bord).
        Returnerar per bord: (antal som står, om en sittande gäst räcker upp handen,
        om en gäst böjer sig ned mot golvet).
        En person räknas bara vid det bord hen sitter närmast (rois = borden i pixlar)."""
        x1 = min(b[0] for b in boxes.values()); y1 = min(b[1] for b in boxes.values())
        x2 = max(b[2] for b in boxes.values()); y2 = max(b[3] for b in boxes.values())
        result = {table_id: (0, False, False) for table_id in boxes}
        for kp in self.pose(frame[y1:y2, x1:x2]):
            center = person_center(kp)
            if center is None:
                continue
            px, py = center[0] + x1, center[1] + y1
            standing = posture(kp) == "standing"
            # Personal som står och pekar eller sträcker sig är inte en gäst som vill ha hjälp
            raised = not standing and hand_raised(kp)
            bending = not standing and bending_down(kp)
            inside = [tid for tid, (bx1, by1, bx2, by2) in boxes.items() if bx1 <= px <= bx2 and by1 <= py <= by2]
            if rois and len(inside) > 1:
                near = {tid: rois[tid] for tid in inside if tid in rois}
                inside = [min(near, key=lambda tid: _roi_distance((px, py), near[tid]))] if near else inside
            for table_id in inside:
                n, r, b = result[table_id]
                result[table_id] = (n + standing, r or raised, b or bending)
        return result

    def classify(self, frame: np.ndarray, tables: list[dict]) -> dict[int, tuple[str, str | None]]:
        """Returnerar {bordsnummer: (status, problem)}. Ett bord som kameran inte
        tydligt ser får CAMERA_BLIND och en förklaring. Då gissas ingenting.
        tables[i]["_anchor"] = bordets kalibreringsbild (gråskala) eller None."""
        now = time.time()
        problem = frame_problem(frame)
        observations: dict[str, Observation] = {}
        surfaces: dict[str, np.ndarray] = {}
        with_people: dict[str, tuple] = {}
        blind: dict[str, str] = {}
        on_hold: set[str] = set()  # kontrollen misslyckas men tålamodet har inte tagit slut

        for table in tables:
            tid = table["id"]
            vis = self.visibility.setdefault(tid, Visibility())
            anchor = table.get("_anchor")
            if anchor is None:
                vis.__init__()
                blind[tid] = ISSUE_NOT_CALIBRATED
                continue
            if problem:
                if not vis.update(False, now, problem):
                    blind[tid] = vis.issue or problem
                else:
                    on_hold.add(tid)
                continue

            roi = (table["roi_x1"], table["roi_y1"], table["roi_x2"], table["roi_y2"])
            box = self.table_box(frame, roi)
            crop = frame[box[1]:box[3], box[0]:box[2]]
            thumb = _thumbnail(crop)
            prev = self.last_seen.get(tid)
            unchanged = (
                prev is not None
                and thumb is not None
                and prev[0].shape == thumb.shape
                and not prev[1].hand_raised  # en uppräckt hand kollas alltid igen
                and not prev[1].bending      # och en gäst som böjer sig ned
                and now - prev[2] < MAX_SKIP_SEC
                and float(cv2.absdiff(prev[0], thumb).mean()) < MOTION_THRESHOLD
            )
            if unchanged:
                # Inget har rört sig: samma som förra gången
                obs, match = prev[1], prev[4]
                if prev[3] is not None:
                    surfaces[tid] = prev[3]
            else:
                fh, fw = frame.shape[:2]
                area = (roi[0] * fw - box[0], roi[1] * fh - box[1], roi[2] * fw - box[0], roi[3] * fh - box[1])
                obs, people = self.observe(crop, (box[0], box[1]), area)
                match = match_anchor(anchor, crop, people)
                surface = _surface(crop, people, area)
                if surface is not None:
                    surfaces[tid] = surface
                    ref = self.clean_ref.get(tid)
                    if ref is not None and ref[0] == roi:
                        obs.clutter = _clutter(ref[1], surface)
                if thumb is not None:
                    self.last_seen[tid] = (thumb, obs, now, surface, match)
                if obs.persons and HAND_DETECTION:
                    with_people[tid] = box

            if not vis.update(match, now):
                blind[tid] = vis.issue or ISSUE_MISMATCH
            elif match is False:
                on_hold.add(tid)
            else:
                observations[tid] = obs

        # En person som syns i grannbordets ruta räknas bara vid det bord hen sitter närmast
        h, w = frame.shape[:2]
        rois = {t["id"]: (t["roi_x1"] * w, t["roi_y1"] * h, t["roi_x2"] * w, t["roi_y2"] * h)
                for t in tables if t["id"] in observations}
        for tid, obs in observations.items():
            obs.persons = sum(
                belongs_to(((x1 + x2) / 2, (y1 + y2) / 2), tid, rois) for x1, y1, x2, y2 in obs.people
            ) if obs.people else obs.seen_persons
            # Det som ligger "nedanför" bordet kan stå på ett bord närmare kameran
            obs.floor_items = tuple(
                (kind, b) for kind, b in obs.floor_items
                if not any(other != tid and _roi_distance(((b[0] + b[2]) / 2, (b[1] + b[3]) / 2), roi) <= 1
                           for other, roi in rois.items())
            )

        with_people = {tid: b for tid, b in with_people.items() if tid in observations and observations[tid].persons}
        if with_people:
            for tid, (standing, raised, bending) in self.people_at_tables(frame, with_people, rois).items():
                obs = observations[tid]
                obs.standing = min(obs.persons, standing)
                obs.hand_raised = raised
                obs.bending = bending

        result: dict[int, tuple[str, str | None]] = {}
        for table in tables:
            self.memory.setdefault(table["id"], TableMemory())
        self.update_rush()
        for table in tables:
            tid = table["id"]
            memory = self.memory[tid]
            self._apply_learning(tid, memory, now)
            if tid in blind:
                # Ett SOS släpps inte bara för att kameran tappar bordet en stund
                result[table["table_number"]] = (EMERGENCY, None) if memory.sos_since else (CAMERA_BLIND, blind[tid])
                continue
            if tid in on_hold:
                result[table["table_number"]] = (memory.last_status, None)
                continue
            obs = observations[tid]
            if obs.persons:
                self.guests_seen_at = now
            was = memory.last_status
            status = memory.update(obs, now, self.orders.get(tid))
            if status == EMERGENCY and was != EMERGENCY:
                print(f"Bord {table['table_number']}: AKUT LÄGE (SOS). {memory.sos.reason if memory.sos else ''}")
            result[table["table_number"]] = (status, None)
            if tid in surfaces and obs.persons == 0:
                roi = (table["roi_x1"], table["roi_y1"], table["roi_x2"], table["roi_y2"])
                self._learn_clean(tid, table["table_number"], roi, surfaces[tid], memory, status, now)
        self._release_pose_if_idle(now)
        return result

    def _learn_clean(self, tid: str, number: int, roi: tuple, surface: np.ndarray, memory: TableMemory, status: str, now: float):
        """Lär sig hur bordet ser ut när det är rent och dukat."""
        ref = self.clean_ref.get(tid)
        if ref is not None and ref[0] != roi:
            ref = None  # bordets ruta har flyttats: börja om
        if memory.relearn_until is not None:
            if now < memory.relearn_until:
                # Personalen har sagt att bordet är avdukat: det här är "rent"
                self.clean_ref[tid] = (roi, surface)
                memory.clean_drinks = None  # glasen som står nu hör till det dukade bordet
                memory.history.clear()
                memory.times.clear()  # gamla mätningar mot förra bilden gäller inte längre
                self.last_seen.pop(tid, None)  # analysera på nytt mot den nya bilden
                print(f"Bord {number}: lärde mig hur bordet ser ut när det är rent.")
            memory.relearn_until = None
        elif ref is None and status == "AVAILABLE" and memory.clean_streak >= 3:
            self.clean_ref[tid] = (roi, surface)  # första gissningen
            self.last_seen.pop(tid, None)
        elif ref is not None and status == "AVAILABLE" and memory.clean_streak >= 10:
            # Följ långsamt med när ljuset ändras under dagen
            self.clean_ref[tid] = (roi, np.where(np.isnan(ref[1]), surface, np.where(np.isnan(surface), ref[1], 0.95 * ref[1] + 0.05 * surface)))

    # --------------------------------------------- Planritning från foto

    def floor_plan_from_photo(self, image_bytes: bytes) -> dict:
        """Gör ett utkast till planritning: hittar bord, stolar, soffor, växter
        och annan inredning på fotot och placerar dem uppifrån sett.
        Admin justerar sedan för hand.

        Den större modellen körs i en egen kortlivad process, så att allt
        minne den använder garanterat lämnas tillbaka när analysen är klar."""
        done = subprocess.run(
            [sys.executable, os.path.abspath(__file__), "--floor-plan"],
            input=image_bytes, capture_output=True, timeout=60,
        )
        if done.returncode != 0:
            lines = done.stderr.decode(errors="replace").strip().splitlines()
            raise RuntimeError(lines[-1] if lines else "okänt fel")
        return json.loads(done.stdout)

    def floor_plan_from_photos(self, photos: list[dict]) -> dict:
        """Som floor_plan_from_photo, men med flera foton tagna från väggarna och hörnen.
        photos = [{"view": "wall-entrance", "image": base64-jpeg}, ...]"""
        done = subprocess.run(
            [sys.executable, os.path.abspath(__file__), "--floor-plan-multi"],
            input=json.dumps({"photos": photos}).encode(), capture_output=True, timeout=240,
        )
        if done.returncode != 0:
            lines = done.stderr.decode(errors="replace").strip().splitlines()
            raise RuntimeError(lines[-1] if lines else "okänt fel")
        return json.loads(done.stdout)


def _thumbnail(crop: np.ndarray):
    """Liten gråskalebild för att se om något har rört sig."""
    if crop.size == 0:
        return None
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    return cv2.GaussianBlur(cv2.resize(gray, (32, 24), interpolation=cv2.INTER_AREA), (3, 3), 0)


SURFACE_SIZE = (64, 48)


def _surface(crop: np.ndarray, people: list[tuple], area: tuple | None = None):
    """Bordsytan som liten, ljusnormerad bild där personerna är bortmaskade (NaN).
    None om nästan hela bordet skyms."""
    if crop.size == 0:
        return None
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    small = cv2.resize(gray, SURFACE_SIZE, interpolation=cv2.INTER_AREA).astype(np.float32)
    small = cv2.GaussianBlur(small, (3, 3), 0)
    sx, sy = SURFACE_SIZE[0] / crop.shape[1], SURFACE_SIZE[1] / crop.shape[0]
    mask = np.zeros(small.shape, bool)
    for x1, y1, x2, y2 in people:
        mask[max(0, int(y1 * sy)):int(np.ceil(y2 * sy)), max(0, int(x1 * sx)):int(np.ceil(x2 * sx))] = True
    if mask.mean() > 0.7:
        return None
    if area is not None:
        # Stolar och golv runt bordet räknas inte: bara själva bordsytan jämförs
        outside = np.ones(small.shape, bool)
        outside[max(0, int(area[1] * sy)):int(np.ceil(area[3] * sy)), max(0, int(area[0] * sx)):int(np.ceil(area[2] * sx))] = False
        if (mask | outside).mean() > 0.85:
            return None
        mask = mask | outside
    visible = small[~mask]
    # Normera ljusstyrka och kontrast så att dagsljus/lampor inte ser ut som smuts
    small = (small - visible.mean()) / (visible.std() + 8.0)
    small[mask] = np.nan
    return small


def _clutter(ref: np.ndarray, now: np.ndarray) -> float | None:
    """Hur stor del av den synliga bordsytan som skiljer sig från det rena bordet."""
    valid = ~np.isnan(ref) & ~np.isnan(now)
    if valid.sum() < 0.3 * max(1, int((~np.isnan(ref)).sum())):
        return None
    return float((np.abs(ref[valid] - now[valid]) > 0.9).mean())


def _expand(box, factor: float):
    w, h = box[2] - box[0], box[3] - box[1]
    return (box[0] - w * factor, box[1] - h * factor, box[2] + w * factor, box[3] + h * factor)


def _clamp(v: float, lo: float, hi: float) -> float:
    return float(min(hi, max(lo, v)))


# --------------------------------------------- Flera foton -> en planritning
# Varje foto tas från en känd plats: mitt på en vägg eller i ett hörn, riktat in i rummet.
# Ritningens koordinater: x 0–1 vänster→höger, y 0–1 överkant→nederkant.
# Väggen med entrén ligger längst ned (y = 1).
_D = 0.7071
VIEWS = {
    # namn: (var fotografen står, åt vilket håll kameran pekar, skala för avståndet)
    "wall-entrance": ((0.5, 1.0), (0.0, -1.0), 1.0),
    "wall-right": ((1.0, 0.5), (-1.0, 0.0), 1.0),
    "wall-far": ((0.5, 0.0), (0.0, 1.0), 1.0),
    "wall-left": ((0.0, 0.5), (1.0, 0.0), 1.0),
    "corner-entrance-right": ((1.0, 1.0), (-_D, -_D), 1.35),
    "corner-far-right": ((1.0, 0.0), (-_D, _D), 1.35),
    "corner-far-left": ((0.0, 0.0), (_D, _D), 1.35),
    "corner-entrance-left": ((0.0, 1.0), (_D, -_D), 1.35),
}


def _observe(detections: list[Detection], W: int, H: int):
    """Det ett foto ser, som om fotografen stod vid entréväggen och tittade in.
    Returnerar bord och inredning med mittpunkt (cx, cy) i den vyn."""
    tables = [d for d in detections if d.cls == DINING_TABLE]
    chairs = [d for d in detections if d.cls == CHAIR]
    if not tables:
        return [], []

    # Fotot är taget snett: nederkanten visar hur långt bort något står.
    bottoms = [d.box[3] / H for d in tables]
    near, far = max(bottoms), min(bottoms)
    depth_span = max(near - far, 0.05)

    def place(d: Detection):
        """Bildposition -> (x-mitt, y-mitt, perspektiv) i vyn (0–1)."""
        depth = _clamp((d.box[3] / H - far) / depth_span, 0, 1)  # 0 = längst bort, 1 = närmast
        perspective = 0.55 + 0.45 * depth  # saker långt bort ser mindre ut
        cx = ((d.box[0] + d.box[2]) / 2) / W
        x = (0.5 + (cx - 0.5) / perspective) * 0.8 + 0.1
        y = 0.12 + depth * 0.72
        return x, y, perspective

    ref_width = median((d.box[2] - d.box[0]) / W / place(d)[2] for d in tables)

    out_tables = []
    for d in tables:
        x, y, perspective = place(d)
        relative = ((d.box[2] - d.box[0]) / W / perspective) / ref_width
        is_long = relative > 1.5
        seats = sum(_overlap_ratio(c.box, _expand(d.box, 0.35)) > 0.3 for c in chairs)
        out_tables.append({
            "cx": x, "cy": y,
            "w": 0.16 if is_long else 0.09, "h": 0.11 if is_long else 0.12,
            "shape": "rect" if is_long else "square",
            "seats": int(max(2, min(12, seats or (6 if is_long else 4)))),
        })

    elements = []

    def add(kind, label, shape, d, w, h):
        x, y, _ = place(d)
        elements.append({"kind": kind, "label": label, "shape": shape, "cx": x, "cy": y, "w": w, "h": h})

    for d in detections:
        if d.cls == POTTED_PLANT:
            add("plant", "Växt", "round", d, 0.045, 0.065)
        elif d.cls in (COUCH, BENCH):
            relative = ((d.box[2] - d.box[0]) / W / place(d)[2]) / ref_width
            add("sofa", "Soffa" if d.cls == COUCH else "Bänk", "rect", d,
                _clamp(0.12 * relative, 0.08, 0.3), 0.06)
        elif d.cls == VASE:
            add("decor", "Vas", "round", d, 0.03, 0.045)
        elif d.cls == CLOCK:
            add("decor", "Klocka", "round", d, 0.03, 0.045)
        elif d.cls == TV:
            add("decor", "TV", "rect", d, 0.08, 0.025)

    # Kök syns ofta som kylskåp/ugn/diskho: rita ett köksområde runt dem
    kitchen = [place(d) for d in detections if d.cls in KITCHEN_HINTS]
    if kitchen:
        xs, ys = [k[0] for k in kitchen], [k[1] for k in kitchen]
        x1, x2 = _clamp(min(xs) - 0.06, 0, 0.9), _clamp(max(xs) + 0.06, 0.1, 1)
        y1, y2 = _clamp(min(ys) - 0.06, 0, 0.9), _clamp(max(ys) + 0.06, 0.1, 1)
        w, h = max(0.1, x2 - x1), max(0.1, y2 - y1)
        elements.append({"kind": "kitchen", "label": "Kök", "shape": "rect",
                         "cx": x1 + w / 2, "cy": y1 + h / 2, "w": w, "h": h})
    return out_tables, elements


def _to_room(item: dict, view: str) -> dict:
    """Flyttar en sak från fotots vy till rummets ritning."""
    (px, py), (fx, fy), scale = VIEWS.get(view, VIEWS["wall-entrance"])
    rx, ry = -fy, fx  # fotots högerhand
    distance = (1 - item["cy"]) * scale  # hur långt in i rummet
    side = (item["cx"] - 0.5) * scale
    x = px + distance * fx + side * rx
    y = py + distance * fy + side * ry
    w, h = item["w"], item["h"]
    if abs(fx) > 0.9:  # fotot taget från en sidovägg: långbord ligger på tvären
        w, h = h, w
    return {**item, "cx": _clamp(x, w / 2, 1 - w / 2), "cy": _clamp(y, h / 2, 1 - h / 2), "w": w, "h": h}


def _merge(items: list[tuple[int, dict]], radius: float, min_support: int, same=lambda a, b: True) -> list[dict]:
    """Slår ihop samma sak sedd på flera foton. items = (fotots nummer, sak).
    Behåller saker som syns på minst min_support foton."""
    clusters: list[dict] = []
    for photo, item in items:
        best, best_d = None, radius
        for c in clusters:
            if photo in c["photos"] or not same(c["items"][0], item):
                continue  # två bord på samma foto är två olika bord
            d = ((c["cx"] - item["cx"]) ** 2 + (c["cy"] - item["cy"]) ** 2) ** 0.5
            if d < best_d:
                best, best_d = c, d
        if best is None:
            best = {"items": [], "photos": set(), "cx": 0.0, "cy": 0.0}
            clusters.append(best)
        best["items"].append(item)
        best["photos"].add(photo)
        best["cx"] = sum(i["cx"] for i in best["items"]) / len(best["items"])
        best["cy"] = sum(i["cy"] for i in best["items"]) / len(best["items"])

    # Andra varvet: två grupper som ligger nära och aldrig syns på samma foto är samma sak
    joined = True
    while joined:
        joined = False
        pairs = sorted(
            ((((a["cx"] - b["cx"]) ** 2 + (a["cy"] - b["cy"]) ** 2) ** 0.5, i, j)
             for i, a in enumerate(clusters) for j, b in enumerate(clusters)
             if i < j and not (a["photos"] & b["photos"]) and same(a["items"][0], b["items"][0])),
        )
        for d, i, j in pairs:
            if d >= radius:
                break
            a, b = clusters[i], clusters[j]
            a["items"] += b["items"]
            a["photos"] |= b["photos"]
            a["cx"] = sum(it["cx"] for it in a["items"]) / len(a["items"])
            a["cy"] = sum(it["cy"] for it in a["items"]) / len(a["items"])
            del clusters[j]
            joined = True
            break

    merged = []
    for c in sorted(clusters, key=lambda c: -len(c["photos"])):
        if len(c["photos"]) < min_support:
            continue
        group = c["items"]
        first = group[0]
        out = {**first, "cx": c["cx"], "cy": c["cy"], "support": len(c["photos"]),
               "w": median(i["w"] for i in group), "h": median(i["h"] for i in group)}
        if "seats" in first:
            out["seats"] = int(round(median(i["seats"] for i in group)))
            out["shape"] = max({i["shape"] for i in group}, key=lambda s: sum(i["shape"] == s for i in group))
        merged.append(out)
    return merged


def build_floor_plan_multi(photos: list[tuple[str, list[Detection], int, int]]) -> dict:
    """photos = (vy, hittade saker, bredd, höjd). Ett bord som syns på flera foton blir ett bord."""
    all_tables, all_elements, per_photo = [], [], []
    for n, (view, detections, W, H) in enumerate(photos):
        tables, elements = _observe(detections, W, H)
        per_photo.append(len(tables))
        all_tables += [(n, _to_room(t, view)) for t in tables]
        all_elements += [(n, _to_room(e, view)) for e in elements]
    if not all_tables:
        return {"aspect_ratio": 1.5, "tables": [], "elements": [], "photos_used": len(photos)}

    # Med många foton krävs att ett bord syns på minst två, annars räknas felträffar med
    seen = sum(1 for c in per_photo if c > 0)
    support = 2 if seen >= 4 else 1
    tables = _merge(all_tables, 0.14, support) or _merge(all_tables, 0.14, 1)
    # Inte fler bord än det dubbla av vad bästa enskilda fotot såg
    tables = tables[: max(per_photo) * 2]
    elements = _merge(all_elements, 0.1, support, same=lambda a, b: a["kind"] == b["kind"])

    plan_tables = [{
        "shape": t["shape"], "seats": t["seats"],
        "x": _clamp(t["cx"] - t["w"] / 2, 0, 1 - t["w"]), "y": _clamp(t["cy"] - t["h"] / 2, 0, 1 - t["h"]),
        "w": t["w"], "h": t["h"], "rotation": 0,
    } for t in tables]
    _spread(plan_tables)
    # Numrera från bortre väggen och framåt, vänster till höger
    plan_tables.sort(key=lambda t: (round(t["y"] * 5), t["x"]))
    for i, t in enumerate(plan_tables, start=1):
        t["table_number"] = i

    plan_elements = [{
        "kind": e["kind"], "label": e["label"], "shape": e["shape"],
        "x": _clamp(e["cx"] - e["w"] / 2, 0, 1 - e["w"]), "y": _clamp(e["cy"] - e["h"] / 2, 0, 1 - e["h"]),
        "w": e["w"], "h": e["h"], "rotation": 0,
    } for e in elements]
    return {"aspect_ratio": 1.5, "tables": plan_tables, "elements": plan_elements, "photos_used": len(photos)}


def build_floor_plan(detections: list[Detection], W: int, H: int) -> dict:
    """Ett enda foto, taget från entréväggen."""
    return build_floor_plan_multi([("wall-entrance", detections, W, H)])


def _spread(items: list[dict], gap: float = 0.02, rounds: int = 30):
    """Skjuter isär bord som hamnat ovanpå varandra."""
    for _ in range(rounds):
        moved = False
        for i, a in enumerate(items):
            for b in items[i + 1:]:
                dx = min(a["x"] + a["w"], b["x"] + b["w"]) - max(a["x"], b["x"]) + gap
                dy = min(a["y"] + a["h"], b["y"] + b["h"]) - max(a["y"], b["y"]) + gap
                if dx <= 0 or dy <= 0:
                    continue
                moved = True
                if dx < dy:  # flytta åt det håll som kräver minst
                    shift = dx / 2 * (1 if b["x"] >= a["x"] else -1)
                    a["x"] = _clamp(a["x"] - shift, 0, 1 - a["w"])
                    b["x"] = _clamp(b["x"] + shift, 0, 1 - b["w"])
                else:
                    shift = dy / 2 * (1 if b["y"] >= a["y"] else -1)
                    a["y"] = _clamp(a["y"] - shift, 0, 1 - a["h"])
                    b["y"] = _clamp(b["y"] + shift, 0, 1 - b["h"])
        if not moved:
            return


if __name__ == "__main__" and sys.argv[1:] == ["--floor-plan"]:
    # Körs av floor_plan_from_photo(): bild in på stdin, planritning (JSON) ut på stdout
    image = cv2.imdecode(np.frombuffer(sys.stdin.buffer.read(), np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        sys.exit("Kunde inte läsa bilden")
    found = ObjectDetector("s")(image, score_thr=0.3)
    print(json.dumps(build_floor_plan(found, image.shape[1], image.shape[0])))

if __name__ == "__main__" and sys.argv[1:] == ["--floor-plan-multi"]:
    # Körs av floor_plan_from_photos(): JSON med foton in på stdin, planritning ut på stdout
    request = json.loads(sys.stdin.buffer.read())
    detector = ObjectDetector("s")
    analyzed = []
    for photo in request.get("photos", [])[:12]:
        try:
            raw = base64.b64decode(photo.get("image", ""), validate=True)
            image = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR) if raw else None
        except (ValueError, cv2.error):
            image = None
        if image is None:
            continue  # trasig bild: hoppa över den
        view = photo.get("view") if photo.get("view") in VIEWS else "wall-entrance"
        analyzed.append((view, detector(image, score_thr=0.3), image.shape[1], image.shape[0]))
    if not analyzed:
        sys.exit("Kunde inte läsa någon av bilderna")
    print(json.dumps(build_floor_plan_multi(analyzed)))
