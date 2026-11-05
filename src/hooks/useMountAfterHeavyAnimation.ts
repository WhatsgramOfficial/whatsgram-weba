import { getIsHeavyAnimating, useEffect, useSignal } from '../lib/teact/teact';

import useDerivedState from './useDerivedState';
import useHeavyAnimation from './useHeavyAnimation';

export default function useMountAfterHeavyAnimation(hasIntersected: boolean) {
  const [getNoHeavyAnimation, setNoHeavyAnimation] = useSignal(false);

  useHeavyAnimation(
    undefined,
    () => setNoHeavyAnimation(true),
  );

  useEffect(() => {
    if (!getIsHeavyAnimating()) {
      setNoHeavyAnimation(true);
    }
  }, [setNoHeavyAnimation]);

  return useDerivedState(() => (getNoHeavyAnimation() && hasIntersected), [getNoHeavyAnimation, hasIntersected]);
}
