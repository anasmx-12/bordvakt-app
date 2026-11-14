import AppShell from '../../components/AppShell';
import FloorPlanEditor from '../../components/FloorPlanEditor';

export default function FloorPlanAdmin() {
  return (
    <AppShell
      title="Planritning"
      subtitle="Fotografera matsalen så ritar AI:n upp borden och inredningen. Justera kartan och spara. Nya bord kalibreras sedan mot en kamera under Installation."
    >
      <FloorPlanEditor />
    </AppShell>
  );
}
