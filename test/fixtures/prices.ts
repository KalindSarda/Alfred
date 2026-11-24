/** Saved answers from the price feeds, trimmed to what the adapters read. */

const row = (session: string, date: string, gold: number, silver: number) => `
        <tr>
          <td class="txt-green ft ht-30" data-label="${session}"><strong>${date}</strong></td>
          <td class="txt-green ft ht-30" data-label="Gold 999">${gold}</td>
          <td class="txt-green ft ht-30" data-label="Gold 995">${gold - 500}</td>
          <td class="txt-green ft ht-30" data-label="Gold 916">${gold - 10500}</td>
          <td class="txt-green ft ht-30" data-label="Silver 999">${silver} </td>
          <td class="txt-green ft ht-30" data-label="Platinum 999">48525 </td>
        </tr>`;

/** IBJA's rates page: an AM table and a PM table. 23/11 has both; the PM gold rate is the later one. */
export const IBJA_HTML = `<div class="tab-content">
  <div id="tab-am" class="tab-pane fade active show"><table class="table-striped"><tbody>${row("AM", "23/11/2026", 125123, 152941)}${row("AM", "20/11/2026", 123584, 150650)}</tbody></table></div>
  <div id="tab-pm" class="tab-pane fade"><table class="table-striped"><tbody>${row("PM", "23/11/2026", 124945, 152625)}</tbody></table></div>
</div>`;

/** The same page with only a morning rate for the newest day. */
export const IBJA_HTML_AM_ONLY = `<div id="tab-am"><table><tbody>${row("AM", "24/11/2026", 125500, 153000)}${row("AM", "23/11/2026", 125123, 152941)}</tbody></table></div><div id="tab-pm"><table><tbody>${row("PM", "23/11/2026", 124945, 152625)}</tbody></table></div>`;

export const YAHOO_SEARCH = JSON.stringify({
  explains: [],
  count: 4,
  quotes: [
    { exchange: "BSE", shortname: "TATA POWER CO.LTD.", quoteType: "EQUITY", symbol: "TATAPOWER.BO", longname: "The Tata Power Company Limited" },
    { exchange: "NSI", shortname: "TATA POWER CO LTD", quoteType: "EQUITY", symbol: "TATAPOWER.NS", longname: "The Tata Power Company Limited" },
    { exchange: "NMS", shortname: "Tata Motors", quoteType: "EQUITY", symbol: "TTM", longname: "Tata Motors Limited" },
    { exchange: "NSI", shortname: "TATA POWER FUTURES", quoteType: "FUTURE", symbol: "TATAPOWER25NOVFUT.NS" },
  ],
  news: [],
});

/** AMFI's daily file: a few real-looking schemes, then enough filler schemes that the file looks whole. */
export const AMFI_TEXT =
  [
    "Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date",
    "",
    "Open Ended Schemes(Equity Scheme - Flexi Cap Fund)",
    "",
    "PPFAS Mutual Fund",
    "",
    "122639;INF879O01027;-;Parag Parikh Flexi Cap Fund;Direct Plan;Growth;94.9255;23-Nov-2026",
    "122640;INF879O01019;-;Parag Parikh Flexi Cap Fund;Regular Plan;Growth;88.1;23-Nov-2026",
    "122641;INF879O01035;INF879O01043;Parag Parikh Flexi Cap Fund;Direct Plan;IDCW;54.2;23-Nov-2026",
    "150685;INF109KC12K1;-;ICICI PRUDENTIAL TRANSPORTATION AND LOGISTICS FUND;Direct Plan;Growth;24.05;23-Nov-2026",
    "999999;INF000000000;-;Some Closed Scheme;Direct Plan;Growth;N.A.;23-Nov-2026",
    ...Array.from({ length: 150 }, (_, i) => `${200000 + i};INF0000000${i};-;Filler Fund ${i};Direct Plan;Growth;${(10 + i / 10).toFixed(4)};23-Nov-2026`),
  ].join("\r\n") + "\r\n";

/** A Yahoo chart answer for a share priced in rupees (or another currency), with the time of the quote. */
export const yahooChart = (symbol: string, price: number, isoTime = "2026-11-23T10:00:00Z", currency = "INR") =>
  JSON.stringify({ chart: { result: [{ meta: { currency, symbol, regularMarketPrice: price, regularMarketTime: Math.floor(Date.parse(isoTime) / 1000) } }], error: null } });
