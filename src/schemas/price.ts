import { z } from "zod";

/** What a holding is, for fetching its price: a Yahoo symbol such as TATAPOWER.NS, or a mutual fund's AMFI scheme code. */
export const LinkPrice = z
  .object({
    feed: z.enum(["yahoo", "amfi"]),
    code: z.string().trim().min(1).max(40),
    label: z.string().trim().max(160).nullable().optional(),
    /** For an investment valued by typing: how many units or shares are held, in 1/10,000. */
    unitsE4: z.number().int().positive().max(100_000_000_000_000).optional(),
  })
  .strict();
export type LinkPriceData = z.output<typeof LinkPrice>;

export const SuggestQuery = z.object({ q: z.string().trim().min(2).max(60), kind: z.enum(["stock", "fund"]) });

export const PreviewQuery = z.object({ feed: z.enum(["gold", "silver"]) });
