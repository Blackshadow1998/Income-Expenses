import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView } from 'react-native';
import { ApiError } from '@/api';
import { useAuth } from '@/auth';
import { PinPad } from '@/components/PinPad';
import { showInfo } from '@/format';
import { t } from '@/i18n';

type Step = 'current' | 'new' | 'confirm';

const TITLES: Record<Step, string> = {
  current: t('pin.currentTitle'),
  new: t('pin.newTitle'),
  confirm: t('pin.newConfirmTitle'),
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
      setError(t('pin.newMismatch'));
      setStep('new');
      return;
    }
    setBusy(true);
    try {
      await setPin(pin, current);
      showInfo(t('pin.changedTitle'), t('pin.changedBody'));
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
