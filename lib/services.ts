// Well-known services and the page where the user manages or cancels them.
// A link is shown ONLY when a detected merchant matches one of these patterns.
// `label` says honestly what the link is: a manage page, or just the help page.

export type KnownService = {
  name: string;
  pattern: RegExp;
  url: string;
  label: "Manage / cancel" | "Open help page" | "Open site";
};

export const KNOWN_SERVICES: KnownService[] = [
  { name: "Netflix", pattern: /netflix/, url: "https://www.netflix.com/cancelplan", label: "Manage / cancel" },
  { name: "Spotify", pattern: /spotify/, url: "https://www.spotify.com/account/subscription/", label: "Manage / cancel" },
  { name: "YouTube Premium", pattern: /youtube|google youtube/, url: "https://www.youtube.com/paid_memberships", label: "Manage / cancel" },
  { name: "Google One", pattern: /google one|googleone/, url: "https://one.google.com/settings", label: "Manage / cancel" },
  { name: "Google Play", pattern: /google play|googleplay|play google/, url: "https://play.google.com/store/account/subscriptions", label: "Manage / cancel" },
  { name: "Apple", pattern: /apple\.com|itunes|apple services|apple media/, url: "https://apps.apple.com/account/subscriptions", label: "Manage / cancel" },
  { name: "Amazon Prime", pattern: /amazon prime|prime video|primevideo|amzn prime/, url: "https://www.amazon.in/gp/primecentral", label: "Manage / cancel" },
  { name: "Audible", pattern: /audible/, url: "https://www.audible.in/account/overview", label: "Manage / cancel" },
  { name: "JioHotstar / Disney+ Hotstar", pattern: /hotstar|jiohotstar|disney/, url: "https://www.hotstar.com/in", label: "Open site" },
  { name: "SonyLIV", pattern: /sony ?liv|sonyliv/, url: "https://help.sonyliv.com/categories/cat-subscription/articles/how-can-i-cancel-my-subscription", label: "Open help page" },
  { name: "ZEE5", pattern: /zee ?5|zee5/, url: "https://helpcenter.zee5.com/", label: "Open help page" },
  { name: "Microsoft", pattern: /microsoft|msft|xbox|office 365|microsoft 365/, url: "https://account.microsoft.com/services", label: "Manage / cancel" },
  { name: "Adobe", pattern: /adobe/, url: "https://account.adobe.com/plans", label: "Manage / cancel" },
  { name: "LinkedIn Premium", pattern: /linkedin/, url: "https://www.linkedin.com/premium/manage", label: "Manage / cancel" },
  { name: "Dropbox", pattern: /dropbox/, url: "https://www.dropbox.com/account/plan", label: "Manage / cancel" },
  { name: "Canva", pattern: /canva/, url: "https://www.canva.com/settings/billing-and-teams", label: "Manage / cancel" },
];

export function findKnownService(merchant: string): KnownService | null {
  const text = merchant.toLowerCase().replace(/[^a-z0-9. ]+/g, " ");
  return KNOWN_SERVICES.find((s) => s.pattern.test(text)) ?? null;
}
