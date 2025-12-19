import type { Bitemporal } from "../models/base";

export const MAX_DATE = 253402300799000; // 9999-12-31

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
