import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView } from 'react-native';
import { ApiError } from '@/api';
import { useAuth } from '@/auth';
import { PinPad } from '@/components/PinPad';
import { showInfo } from '@/format';

type Step = 'current' | 'new' | 'confirm';

const TITLES: Record<Step, string> = {
  current: 'ใส่ PIN ปัจจุบัน',
  new: 'ตั้ง PIN ใหม่ 6 หลัก',
  confirm: 'ยืนยัน PIN ใหม่อีกครั้ง',
};

export default function ChangePinScreen() {
  const { setPin, status } = useAuth();
  const [step, setStep] = useState<Step>('current');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onComplete = async (pin: string) => {
    setError(null);
    if (step === 'current') {
      setCurrent(pin);
      setStep('new');
      return;
    }
    if (step === 'new') {
      setNext(pin);
      setStep('confirm');
      return;
    }
    if (pin !== next) {
      setError('PIN ใหม่สองครั้งไม่ตรงกัน กรุณาตั้งใหม่');
      setStep('new');
      return;
    }
    setBusy(true);
    try {
      await setPin(pin, current);
      showInfo('เปลี่ยน PIN แล้ว', 'ครั้งต่อไปให้ใช้ PIN ใหม่ปลดล็อกแอป');
      router.back();
    } catch (e) {
      // Wrong current PIN: start over. Too-simple new PIN: choose another.
      const wrongCurrent = e instanceof ApiError && e.code === 'wrong_pin';
      setStep(wrongCurrent ? 'current' : 'new');
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}>
      <PinPad
        title={TITLES[step]}
        error={error}
        busy={busy}
        onComplete={onComplete}
        listenKeys={status === 'ready'} // the lock screen may be on top
      />
    </ScrollView>
  );
}
