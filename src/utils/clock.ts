import { type IstDate, todayIst } from "../domain/dates";

/** Today in IST, honouring the injectable clock used by tests. */
export const requestToday = (deps: { now?: () => number }): IstDate => todayIst(new Date((deps.now ?? Date.now)()));
