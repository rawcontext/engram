export const MAX_DATE = 253402300799000; // 9999-12-31

export interface Bitemporal {
  vt_start: number; // Epoch Milliseconds
  vt_end: number; // Epoch Milliseconds (MaxDate if current)
  tt_start: number; // Epoch Milliseconds
  tt_end: number; // Epoch Milliseconds (MaxDate if current)
}

export const now = () => Date.now();

export const createBitemporal = (validFrom: number = now()): Bitemporal => {
  const t = now();
  return {
    vt_start: validFrom,
    vt_end: MAX_DATE,
    tt_start: t,
    tt_end: MAX_DATE,
  };
};
