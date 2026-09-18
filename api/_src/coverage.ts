import type { Persona } from './personas.js';
import {
  atLeast,
  personDepartmentToFn,
  personSeniority,
} from './taxonomy.js';

export interface CoveragePerson {
  id: string;
  name: string;
  title: string;
  department: string | null;
  jobLevel?: string | null;
}

export interface PersonaCoverage {
  personaId: string;
  name: string;
  required: boolean;
  matches: { personId: string; name: string; title: string }[];
  covered: boolean;
}

export interface MapCoverage {
  personas: PersonaCoverage[];
  /** Required personas with at least one match. */
  coveredCount: number;
  requiredCount: number;
  /** All personas (required or not) with at least one match. */
  totalCovered: number;
}

/**
 * A person fills a persona when they clear its seniority floor and either
 * sit in one of its functions (empty = any) or carry one of its title
 * keywords.
 */
export function personMatchesPersona(
  persona: Pick<Persona, 'functions' | 'minSeniority' | 'titleKeywords'>,
  person: CoveragePerson
): boolean {
  const title = person.title ?? '';
  if (!atLeast(personSeniority(person.jobLevel ?? null, title), persona.minSeniority)) {
    return false;
  }
  if (persona.functions.length === 0) return true;
  if (persona.functions.includes(personDepartmentToFn(person.department, title))) {
    return true;
  }
  const lower = title.toLowerCase();
  return persona.titleKeywords.some((k) => lower.includes(k));
}

export function computeCoverage(
  personas: Persona[],
  people: CoveragePerson[]
): MapCoverage {
  const ordered = [...personas].sort((a, b) => a.sortOrder - b.sortOrder);
  const result: PersonaCoverage[] = ordered.map((persona) => {
    const matches = people
      .filter((person) => personMatchesPersona(persona, person))
      .map((person) => ({
        personId: person.id,
        name: person.name,
        title: person.title,
      }));
    return {
      personaId: persona.id,
      name: persona.name,
      required: persona.required,
      matches,
      covered: matches.length > 0,
    };
  });
  const required = result.filter((p) => p.required);
  return {
    personas: result,
    coveredCount: required.filter((p) => p.covered).length,
    requiredCount: required.length,
    totalCovered: result.filter((p) => p.covered).length,
  };
}
