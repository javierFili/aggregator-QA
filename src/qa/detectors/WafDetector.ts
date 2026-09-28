/**
 * Recognises anti-bot / WAF interstitials (Cloudflare "Performing security verification", "Just a moment…",
 * Turnstile, etc.). Such a page means the QA tool was stopped BEFORE reaching the game: it is not a game failure.
 */
const WAF_TEXT =
  /performing security verification|checking (if the site connection is secure|your browser)|verify(ing)? you are (a )?human|just a moment\.\.\.|attention required! \| cloudflare|enable javascript and cookies to continue|ddos protection by|this website uses a security service to protect against malicious bots/i;
const WAF_MARKUP = /challenges\.cloudflare\.com|cdn-cgi\/challenge-platform|cf-chl-|cf_chl_|__cf_chl/i;

export const WAF_DESCRIPTION = 'Bloqueado por la verificación anti-bot de Cloudflare antes de llegar al juego (no es un fallo del juego)';

export function isWafChallenge(input: { text?: string; html?: string; url?: string }): boolean {
  if (input.url && WAF_MARKUP.test(input.url)) return true;
  if (input.html && (WAF_MARKUP.test(input.html) || WAF_TEXT.test(input.html))) return true;
  return !!input.text && WAF_TEXT.test(input.text);
}
