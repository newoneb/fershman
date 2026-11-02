/*
 * The Fershman Journal — site configuration
 * -----------------------------------------
 * This is the only file you need to edit by hand.
 *
 * 1. Leave `supabase.url` and `supabase.key` empty to run in DEMO MODE:
 *    the site works instantly, and the admin panel and member portal save
 *    to your own browser only.
 * 2. Paste your Supabase project URL and publishable key to go LIVE:
 *    articles, members and files are then shared by everyone.
 *    (Admin → Settings → "Go live" can generate this file for you.)
 *
 * The publishable key is designed to be public. Never put a secret key here.
 */
export default {
  supabase: {
    url: "https://sykqhnoklqmiosghlnbe.supabase.co",
    key: "sb_publishable_JbHljvWj0OeGYU0wnC35EA_jh1E_8nq",
  },

  site: {
    name: "The Fershman Journal",
    shortName: "Fershman",
    tagline: "Tomorrow's news, delivered today",
    description:
      "Sharp analysis and original commentary on M&A, global markets and financial policy — written by students, for anyone who wants to understand the deals and decisions moving the economy.",
    url: "https://www.fershman.com",
    contactEmail: "eliazar@uchicago.edu",
    applyContacts: ["eliazar@uchicago.edu", "regelman@uchicago.edu"],
    social: {
      x: "https://x.com/fershman_",
      instagram: "https://www.instagram.com/fershman_/",
      linkedin: "https://www.linkedin.com/company/fershman",
    },
  },

  // Sections appear in the navigation in this order.
  // `slug` is the URL: /categories/<slug>. These match the old site's URLs.
  sections: [
    { slug: "markets", name: "Markets", description: "Rates, equities, credit and commodities — what is moving prices and why." },
    { slug: "business-deals", name: "Business & Deals", description: "M&A, restructurings, IPOs and the strategy behind the biggest transactions." },
    { slug: "policy", name: "Policy & Regulation", description: "Central banks, regulators and the rules that shape markets." },
    { slug: "opinion", name: "Opinion", description: "Arguments from our writers. Their views, clearly labeled." },
    { slug: "future-outlook", name: "Future Outlook", description: "Where technology, capital and geopolitics are heading next." },
    { slug: "history-parallels", name: "History & Parallels", description: "Today's markets read against the episodes that came before." },
  ],

  // The Learn Economics hub (/learn). Lessons are articles in the "learn" section.
  learn: {
    name: "Learn Economics",
    description: "Free lessons that build economic intuition from first principles.",
    topics: ["Microeconomics", "Macroeconomics"],
  },

  // Suggestions for the small topic line above headlines (editors can type anything).
  topics: [
    "M&A and Restructuring", "Commodities & Energy", "Macro Risks", "Disruption Watch",
    "C-Suite & Leadership", "Healthcare", "Central Banking", "TMT", "Private Credit", "Fintech",
  ],

  // Groups on the Authors page, in display order.
  authorTeams: ["Leadership", "Editors", "Analysts", "Staff Writers", "Contributors"],

  // Live market strip under the navigation (free TradingView widget).
  // Set enabled: false to hide it.
  ticker: {
    enabled: true,
    symbols: [
      { proName: "FOREXCOM:SPXUSD", title: "S&P 500" },
      { proName: "FOREXCOM:NSXUSD", title: "Nasdaq 100" },
      { proName: "FOREXCOM:DJI", title: "Dow 30" },
      { proName: "TVC:US10Y", title: "US 10Y" },
      { proName: "OANDA:XAUUSD", title: "Gold" },
      { proName: "TVC:USOIL", title: "WTI Crude" },
      { proName: "FX_IDC:EURUSD", title: "EUR/USD" },
      { proName: "BITSTAMP:BTCUSD", title: "Bitcoin" },
    ],
  },

  portal: {
    name: "Members",
    maxUploadMB: 50, // Supabase free plan limit per file
  },
};
