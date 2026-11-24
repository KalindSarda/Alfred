/**
 * The guided tour: one step per screen worth knowing, in the order a newcomer should see them. `look` says what to notice on any
 * data; `sample` adds what to notice in the sample data, shown only while the sample is loaded.
 */
export interface TourStep {
  id: string;
  title: string;
  /** The screen it opens, including any "?view=" or "#card". */
  to: string;
  /** What this screen is, in a line or two of plain words. */
  what: string;
  look: string[];
  sample: string[];
}

export const TOUR: TourStep[] = [
  {
    id: "briefing",
    title: "Your briefing",
    to: "/",
    what: "Alfred's summary of where you stand, in plain sentences: what needs you, what is coming, how you are doing.",
    look: ["The dark card at the top: each line is one thing worth knowing today.", "Tap a line to open the screen behind it."],
    sample: ["There is a bill waiting for you to confirm, an entry with no category, and a card instalment still to be billed."],
  },
  {
    id: "week",
    title: "This week",
    to: "/#allowance",
    what: "Your spending money after rent, EMIs, goals and the money you move first, cut into weeks. What you do not spend rolls into next week.",
    look: ["The big number is what is left this week, with about how much a day.", "The bar with a tick compares your spending with an even pace for the month.", "The streak counts days in a row with nothing spent."],
    sample: ["The sample has three quiet days in a row, so the streak shows. Spend something and watch the week change."],
  },
  {
    id: "cashflow",
    title: "Cash flow and trends",
    to: "/trends",
    what: "Where your money came from and where it went, for your month, by category and by account.",
    look: ["The pills at the top change the period.", "Net worth over time is further down.", "Moving money between your own accounts, and paying a card bill, is not counted as spending."],
    sample: ["Salary arrives on the 1st. Rent, the card and fuel are the big spends."],
  },
  {
    id: "accounts",
    title: "Accounts and cards",
    to: "/money",
    what: "Every bank account, wallet and credit card with what it holds or owes, and your net worth.",
    look: ["Safe to spend is your money after card bills, blocked money and goals.", "A card shows how much of its limit is used, and its statement and due days.", "Money marked as your emergency fund is kept apart."],
    sample: ["Demo Savings is the emergency fund. Demo Card has a bill and a phone instalment on it."],
  },
  {
    id: "commitments",
    title: "What is due soon",
    to: "/money?view=commitments",
    what: "Everything that leaves your accounts before the next salary: rent, EMIs, loan instalments, SIPs.",
    look: ["Free to spend is safe to spend minus what is still to go out.", "A warning shows when an account cannot cover what is due from it."],
    sample: ["The window ends at the next salary day. Rent, the bike loan, the SIP and the phone instalment appear as their days come inside it."],
  },
  {
    id: "owing",
    title: "EMIs, loans, lent and blocked",
    to: "/money?view=commitments#emi",
    what: "Card purchases paid in instalments, bank loans, money you lent or borrowed, and money held for an IPO.",
    look: ["Each has its own card: scroll down this screen to see them all."],
    sample: ["Demo Phone: ₹24,000 over 6 months on the card. Bike loan: ₹60,000 at 12%, each instalment split into interest and principal.", "Ravi owes you ₹2,000 of the ₹3,000 you lent. You owe Meera ₹2,000.", "₹15,000 is held for an IPO until the result."],
  },
  {
    id: "investments",
    title: "Investments",
    to: "/money?view=investments",
    what: "What you own, what you put in, and what it is worth, by broker account and kind.",
    look: ["Invested, Value and Gain line up in columns.", "Open a card to see what is inside it."],
    sample: ["Demo Broker holds a stock, an index fund and a shared stock. In the shared stock Ravi put in 40%, so only your 60% counts.", "Gold by weight and EPF sit outside any broker."],
  },
  {
    id: "budgets",
    title: "Budgets",
    to: "/plan?view=budgets",
    what: "A monthly limit for a category and how far you have gone.",
    look: ["Green means comfortable, amber means close to the limit, red means over."],
    sample: ["Groceries is comfortable, Food and Dining is close, Entertainment is over."],
  },
  {
    id: "recurring",
    title: "Recurring entries",
    to: "/plan?view=recurring",
    what: "Salary, rent, subscriptions and SIPs that add themselves on their day, so you do not log them.",
    look: ["A rule adds its entry by itself, or waits for you to confirm it.", "You can skip one month or pause a rule."],
    sample: ["Salary, rent, Netflix and the SIP are automatic. The electricity bill waits for you to confirm. EPF adds your share and your employer's to the investment."],
  },
  {
    id: "goals",
    title: "Savings goals",
    to: "/plan?view=goals",
    what: "Money set aside for something, with how much to save each month to get there on time.",
    look: ["Each goal shows what is saved, what is left and what to put aside each month."],
    sample: ["A trip to Goa and a new laptop, each with a target date."],
  },
  {
    id: "movefirst",
    title: "Move first, and your foundations",
    to: "/plan",
    what: "Pay yourself first: money you move out each month before you spend. Below it, the ladder of money basics.",
    look: ["Tap Moved once you have made the transfer. It is held back from what you can spend until then.", "The ladder shows emergency fund, cover and independence, one rung at a time."],
    sample: ["Move to savings is done. Top up the fund is still held back."],
  },
  {
    id: "cover",
    title: "Cover",
    to: "/plan?view=protection",
    what: "Health and life cover, where you have gaps, and renewal reminders.",
    look: ["Two questions at the top shape what Alfred says about gaps.", "Policies list what is covered and when each renews."],
    sample: ["A health policy renews in about three weeks. There is no term cover, so the gap shows."],
  },
  {
    id: "telegram",
    title: "Telegram",
    to: "/settings#telegram",
    what: "Log an expense by typing it, ask how you are doing, and get reminders, all in a chat.",
    look: ["Link once with the code shown here, then message the bot.", "Try: 450 food swiggy, or ask /today, /balance, /summary."],
    sample: ["Telegram works on your own data. Link it after you clear the sample, so your first entries are real."],
  },
];
