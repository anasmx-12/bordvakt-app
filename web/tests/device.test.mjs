import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installMethod, wakeDefault } from '../lib/device.ts';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const IOS_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1';

test('installerad app behöver ingen guide', () => {
  assert.equal(installMethod({ ua: ANDROID, standalone: true, canPrompt: true, touchPoints: 5 }), 'installed');
});

test('webbläsare med installationsknapp', () => {
  assert.equal(installMethod({ ua: ANDROID, standalone: false, canPrompt: true, touchPoints: 5 }), 'prompt');
});

test('iPhone och iPad (som säger Macintosh men har pekskärm) får stegen för Safari', () => {
  assert.equal(installMethod({ ua: IPHONE, standalone: false, canPrompt: false, touchPoints: 5 }), 'ios');
  assert.equal(installMethod({ ua: IPAD, standalone: false, canPrompt: false, touchPoints: 5 }), 'ios');
  assert.equal(installMethod({ ua: IOS_CHROME, standalone: false, canPrompt: false, touchPoints: 5 }), 'ios');
});

test('Mac utan pekskärm och utan knapp får den allmänna texten', () => {
  assert.equal(installMethod({ ua: IPAD, standalone: false, canPrompt: false, touchPoints: 0 }), 'other');
});

test('skärmen hålls vaken från början bara på installerade surfplattor', () => {
  assert.equal(wakeDefault({ standalone: true, width: 1024 }), true);
  assert.equal(wakeDefault({ standalone: true, width: 390 }), false);
  assert.equal(wakeDefault({ standalone: false, width: 1024 }), false);
});
