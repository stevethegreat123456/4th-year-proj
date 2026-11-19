export interface DCirclesSignal {
  mostDigits: number[];
  leastDigits: number[];
  maxCount: number;
  minCount: number;
  hasSpread: boolean;
  direction: 'EVEN' | 'ODD' | null;
  contractType: 'DIGITEVEN' | 'DIGITODD' | null;
  triggerDigits: number[];
}

export function evaluateDCirclesSignal(counts: number[]): DCirclesSignal {
  if (!Array.isArray(counts) || counts.length !== 10) {
    return {
      mostDigits: [],
      leastDigits: [],
      maxCount: 0,
      minCount: 0,
      hasSpread: false,
      direction: null,
      contractType: null,
      triggerDigits: [],
    };
  }

  let maxCount = -1;
  let minCount = Infinity;
  let total = 0;

  for (let i = 0; i < 10; i++) {
    const c = counts[i] || 0;
    total += c;
    if (c > maxCount) maxCount = c;
    if (c < minCount) minCount = c;
  }

  const hasSpread = total > 0 && maxCount > minCount;
  if (!hasSpread) {
    return {
      mostDigits: [],
      leastDigits: [],
      maxCount: Math.max(0, maxCount),
      minCount: minCount === Infinity ? 0 : minCount,
      hasSpread: false,
      direction: null,
      contractType: null,
      triggerDigits: [],
    };
  }

  const mostDigits: number[] = [];
  const leastDigits: number[] = [];

  for (let d = 0; d < 10; d++) {
    const c = counts[d] || 0;
    if (c === maxCount) mostDigits.push(d);
    if (c === minCount) leastDigits.push(d);
  }

  const allMostEven = mostDigits.length > 0 && mostDigits.every((d) => d % 2 === 0);
  const allLeastEven = leastDigits.length > 0 && leastDigits.every((d) => d % 2 === 0);
  const allMostOdd = mostDigits.length > 0 && mostDigits.every((d) => d % 2 !== 0);
  const allLeastOdd = leastDigits.length > 0 && leastDigits.every((d) => d % 2 !== 0);

  if (allMostEven && allLeastEven) {
    return {
      mostDigits,
      leastDigits,
      maxCount,
      minCount,
      hasSpread: true,
      direction: 'EVEN',
      contractType: 'DIGITEVEN',
      triggerDigits: Array.from(new Set([...mostDigits, ...leastDigits])),
    };
  }

  if (allMostOdd && allLeastOdd) {
    return {
      mostDigits,
      leastDigits,
      maxCount,
      minCount,
      hasSpread: true,
      direction: 'ODD',
      contractType: 'DIGITODD',
      triggerDigits: Array.from(new Set([...mostDigits, ...leastDigits])),
    };
  }

  return {
    mostDigits,
    leastDigits,
    maxCount,
    minCount,
    hasSpread: true,
    direction: null,
    contractType: null,
    triggerDigits: [],
  };
}
