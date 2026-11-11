import { z } from "zod";
import { Id, IstDateString } from "./transaction";

const Name = z.string().trim().min(1).max(40);
const Lender = z.string().trim().max(60);
const Amount = z.number().int().positive().max(100_000_000_000_00);
const Pct = z.number().min(0).max(100);
const DueDay = z.number().int().min(1).max(31);

export const LOAN_KINDS = ["home", "car", "personal", "education", "other"] as const;
export const LoanKind = z.enum(LOAN_KINDS);

export const CreateLoan = z
  .object({
    name: Name,
    lender: Lender.nullable().optional(),
    kind: LoanKind,
    /** The bank account the instalments are paid from. */
    accountId: Id,
    /** What is still outstanding now. */
    principalPaise: Amount,
    /** Yearly rate in percent, such as 8.5. */
    ratePct: Pct,
    /** Months left: the EMI is then calculated. Give this or `emiPaise`. */
    months: z.number().int().min(1).max(600).optional(),
    /** The EMI as the bank charges it. */
    emiPaise: Amount.optional(),
    dueDay: DueDay,
    /** The day the outstanding figure is as of; defaults to today, not in the future. */
    asOf: IstDateString.optional(),
    /** The first instalment Alfred adds; defaults to the next due day after `asOf`. */
    firstDueDate: IstDateString.optional(),
  })
  .strict();
export type CreateLoanData = z.output<typeof CreateLoan>;

export const UpdateLoan = z
  .object({ name: Name, lender: Lender.nullable(), kind: LoanKind, accountId: Id, dueDay: DueDay, emiPaise: Amount })
  .partial()
  .strict();
export type UpdateLoanData = z.output<typeof UpdateLoan>;

export const PrepayLoan = z.object({ amountPaise: Amount, date: IstDateString.optional(), effect: z.enum(["shorten", "lower"]) }).strict();
export type PrepayLoanData = z.output<typeof PrepayLoan>;

export const ChangeRate = z.object({ ratePct: Pct, keep: z.enum(["emi", "tenure"]) }).strict();
export type ChangeRateData = z.output<typeof ChangeRate>;

export const ForecloseLoan = z.object({ chargesPaise: Amount.optional(), date: IstDateString.optional() }).strict();
export type ForecloseLoanData = z.output<typeof ForecloseLoan>;

export const SetInstalmentTotal = z.object({ totalPaise: Amount }).strict();
export type SetInstalmentTotalData = z.output<typeof SetInstalmentTotal>;

/** What a part-payment would do, without recording it. */
export const SimulatePrepay = z.object({ amountPaise: Amount, effect: z.enum(["shorten", "lower"]), returnPct: z.number().min(0).max(50).optional() }).strict();
export type SimulatePrepayData = z.output<typeof SimulatePrepay>;

export const ListLoansQuery = z.object({ status: z.enum(["active", "all"]).default("active") });
