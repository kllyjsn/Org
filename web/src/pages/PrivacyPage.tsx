import { Link } from 'react-router-dom';
import { Wordmark } from '../components/Wordmark';
import { useDocumentTitle } from '../lib/useDocumentTitle';

const sections: [string, string[]][] = [
  [
    'What TopDown stores',
    [
      'Your account email, name, and hashed password.',
      'Workspaces, org maps, rosters, comments, and research results you create.',
      'Usage analytics (feature events like map creation and exports) tied to your account, kept for 24 months.',
    ],
  ],
  [
    'What the browser extension accesses',
    [
      'The TopDown for LinkedIn extension reads the contents of a linkedin.com or Sales Navigator page only when you click its toolbar action or a button it renders on the page. It sends the parsed fields — names, titles, and profile URLs — to your TopDown workspace over HTTPS.',
      'It never reads pages you have not explicitly imported, never runs in the background on other sites, and does not collect your LinkedIn credentials.',
      'The optional "any site" host permission exists only so self-hosted deployments can point the extension at a custom API URL; it is requested at the moment you enter one, not at install.',
    ],
  ],
  [
    'Third-party processors',
    [
      'LLM providers (Google Gemini, OpenRouter, or Perplexity) receive the target domain and research prompts to produce org charts.',
      'Optional enrichment providers (Sumble, Exa, Apollo) receive the company domain when workspace roster sync runs.',
      'Stripe processes billing; it receives your email, never your map data. Resend delivers transactional email (verify, reset, invites).',
    ],
  ],
  [
    'Retention and deletion',
    [
      'Deleting your account or workspace removes its maps, rosters, members, and sessions. Share links can be revoked at any time.',
      'Sessions expire automatically; expired sessions and finished research jobs are swept on a schedule.',
    ],
  ],
  [
    'What we never do',
    [
      'We do not sell your data, show ads, or use your maps to train models.',
    ],
  ],
  [
    'Contact',
    [
      'Questions or deletion requests: support@topdown.sh.',
    ],
  ],
];

export default function PrivacyPage() {
  useDocumentTitle('Privacy — TopDown');
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-6 py-6">
        <Link to="/login" aria-label="TopDown">
          <Wordmark />
        </Link>
      </header>
      <main className="mx-auto max-w-3xl px-6 pb-20">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
          Privacy
        </h1>
        <p className="mt-2 text-sm text-slate-500">Last updated September 2026</p>
        <div className="mt-8 space-y-8">
          {sections.map(([title, items]) => (
            <section key={title}>
              <h2 className="text-lg font-medium text-slate-900">{title}</h2>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-[15px] leading-6 text-slate-600">
                {items.map((item) => (
                  <li key={item.slice(0, 40)}>{item}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
