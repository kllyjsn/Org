import type { Person, SellerProfile } from '../types';

type BuyingFunction =
  | 'engineering'
  | 'security'
  | 'data'
  | 'revenue'
  | 'marketing'
  | 'finance'
  | 'people'
  | 'operations';

const FUNCTION_SIGNALS: Record<BuyingFunction, RegExp> = {
  engineering:
    /\b(developer|development|engineering|software|api|platform|infrastructure|cloud|devops|sre|architecture|technical|technology|cto|cio)\b/i,
  security:
    /\b(security|cyber|identity|compliance|risk|privacy|ciso|trust)\b/i,
  data: /\b(data|analytics|machine learning|artificial intelligence|\bai\b|insights|database)\b/i,
  revenue:
    /\b(revenue|sales|account executive|customer success|go.to.market|\bgtm\b|commercial|cro)\b/i,
  marketing: /\b(marketing|brand|demand generation|growth|communications|cmo)\b/i,
  finance:
    /\b(finance|financial|payments|billing|treasury|procurement|purchasing|cfo|controller)\b/i,
  people:
    /\b(people|human resources|\bhr\b|talent|recruiting|workforce|chro)\b/i,
  operations:
    /\b(operations|operational|supply chain|workflows?|productivity|coo)\b/i,
};

function functionsIn(value: string): BuyingFunction[] {
  return (Object.entries(FUNCTION_SIGNALS) as [BuyingFunction, RegExp][])
    .filter(([, pattern]) => pattern.test(value))
    .map(([name]) => name);
}

export function sellerBuyingFunctions(
  profile: SellerProfile | null | undefined
): BuyingFunction[] {
  if (!profile) return [];
  const scores = new Map<BuyingFunction, number>();
  const add = (values: string[], weight: number) => {
    for (const name of functionsIn(values.join(' '))) {
      scores.set(name, (scores.get(name) ?? 0) + weight);
    }
  };
  add(profile.products, 3);
  add(profile.useCases, 3);
  add([profile.positioning], 2);
  add([profile.summary], 1);
  add(profile.targetCustomers, 1);
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const strongest = ranked[0]?.[1] ?? 0;
  return ranked
    .filter(([, score]) => score >= Math.max(2, strongest * 0.6))
    .slice(0, 2)
    .map(([name]) => name);
}

export function personProductFit(
  person: Person,
  profile: SellerProfile | null | undefined
): number {
  const sellerFunctions = new Set(sellerBuyingFunctions(profile));
  if (sellerFunctions.size === 0) return 0;
  const personFunctions = functionsIn(
    [person.title, person.department, person.team, person.productLine]
      .filter(Boolean)
      .join(' ')
  );
  const matches = personFunctions.filter((name) => sellerFunctions.has(name));
  if (matches.length > 0) return 70 + (matches.length - 1) * 10;
  return personFunctions.length > 0 ? -110 : -30;
}

export function sellerBuyingFunctionLabel(
  profile: SellerProfile | null | undefined
): string | null {
  const functions = sellerBuyingFunctions(profile);
  if (functions.length === 0) return null;
  return functions
    .slice(0, 2)
    .map((name) => (name === 'people' ? 'people / talent' : name))
    .join(' + ');
}
