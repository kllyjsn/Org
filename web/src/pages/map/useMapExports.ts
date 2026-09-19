import { useCallback, useState } from 'react';
import type { ChangeEvent } from 'react';
import { getNodesBounds, getViewportForBounds } from 'reactflow';
import type { Node, ReactFlowInstance } from 'reactflow';
import { toPng } from 'html-to-image';
import { api } from '../../api';
import { reportsEdge } from '../../lib/flowEdges';
import type { FlowEdge } from '../../lib/flowEdges';
import { parseCsv } from '../../lib/csv';
import { planPngExport } from '../../lib/pngExport';
import {
  corroborationCount,
  evidenceFreshness,
  canonicalPersonName,
} from '../../lib/researchQuality';
import type { PersonNodeData } from '../../components/PersonNode';
import type { MapState, Person, ResearchResult } from '../../types';

export function useMapExports(deps: {
  mapId: string | undefined;
  mapName: string;
  readOnly: boolean;
  rf: ReactFlowInstance;
  displayNodes: Node[];
  nodes: Node<PersonNodeData>[];
  edges: FlowEdge[];
  nodesRef: { current: Node<PersonNodeData>[] };
  edgesRef: { current: FlowEdge[] };
  meta: MapState['meta'] | null;
  metaRef: { current: MapState['meta'] | null };
  setMeta: (meta: MapState['meta'] | null) => void;
  setNodes: (ns: Node<PersonNodeData>[]) => void;
  setEdges: (es: FlowEdge[]) => void;
  relayLanes: (ns: Node<PersonNodeData>[]) => Node<PersonNodeData>[];
  lanesChanged: (
    before: Node<PersonNodeData>[],
    after: Node<PersonNodeData>[]
  ) => boolean;
  recordHistory: () => void;
  markDirty: (ns: Node<PersonNodeData>[], es: FlowEdge[]) => void;
  setImportNotice: (notice: string) => void;
}) {
  const {
    mapId,
    mapName,
    readOnly,
    rf,
    displayNodes,
    nodes,
    edges,
    nodesRef,
    edgesRef,
    meta,
    metaRef,
    setMeta,
    setNodes,
    setEdges,
    relayLanes,
    lanesChanged,
    recordHistory,
    markDirty,
    setImportNotice,
  } = deps;

  const [exportingAccountPlan, setExportingAccountPlan] = useState(false);

  const exportPng = useCallback(async () => {
    const el = document.querySelector('.react-flow__viewport') as HTMLElement;
    // displayNodes is exactly what's rendered: packed collapsed lanes,
    // lane headers, +N tiles, and the active grouping — so the PNG is 1:1
    // with the canvas instead of the raw saved positions.
    if (!el || displayNodes.length === 0) return;
    try {
      const bounds = getNodesBounds(displayNodes);
      const plan = planPngExport(bounds);
      const flow = document.querySelector('.react-flow') as HTMLElement | null;
      if (plan.mode === 'viewport') {
        if (!flow) return;
        const current = rf.getViewport();
        const width = flow.clientWidth;
        const height = flow.clientHeight;
        const url = await toPng(el, {
          backgroundColor: '#f8fafc',
          width,
          height,
          style: {
            width: `${width}px`,
            height: `${height}px`,
            transform: `translate(${current.x}px, ${current.y}px) scale(${current.zoom})`,
          },
        });
        const a = document.createElement('a');
        a.href = url;
        a.download = `${mapName || 'org-map'}.png`;
        a.click();
        setImportNotice(plan.reason);
        window.setTimeout(() => setImportNotice(''), 5_000);
        return;
      }
      const vp = getViewportForBounds(
        bounds,
        plan.width,
        plan.height,
        plan.zoom,
        plan.zoom,
        0.08
      );
      const url = await toPng(el, {
        backgroundColor: '#f8fafc',
        width: plan.width,
        height: plan.height,
        style: {
          width: `${plan.width}px`,
          height: `${plan.height}px`,
          transform: `translate(${vp.x}px, ${vp.y}px) scale(${plan.zoom})`,
        },
      });
      const a = document.createElement('a');
      a.href = url;
      a.download = `${mapName || 'org-map'}.png`;
      a.click();
      if (plan.zoom < 0.6) {
        setImportNotice(
          `Large map — exported at ${Math.round(plan.zoom * 100)}% scale`
        );
        window.setTimeout(() => setImportNotice(''), 5_000);
      }
    } catch {
      setImportNotice('PNG export failed — try again.');
      window.setTimeout(() => setImportNotice(''), 5_000);
    }
  }, [displayNodes, mapName, rf, setImportNotice]);

  const exportAccountPlan = useCallback(async () => {
    if (!mapId || exportingAccountPlan) return;
    setExportingAccountPlan(true);
    setImportNotice('Exporting account plan…');
    try {
      await api.downloadMapExport(mapId);
      setImportNotice('Account plan exported.');
    } catch (error) {
      setImportNotice(
        error instanceof Error
          ? error.message
          : 'Account plan export failed — try again.'
      );
    } finally {
      setExportingAccountPlan(false);
      window.setTimeout(() => setImportNotice(''), 5_000);
    }
  }, [exportingAccountPlan, mapId, setImportNotice]);

  const importCrmCsv = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file || readOnly) return;
      const rows = parseCsv(await file.text());
      if (rows.length === 0) {
        setImportNotice('No CRM contacts found in that CSV.');
        return;
      }
      recordHistory();
      let updated = 0;
      let added = 0;
      let skipped = 0;
      const center = rf.screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      });
      const pick = (
        row: Record<string, string>,
        ...keys: string[]
      ): string => {
        for (const key of keys) {
          const value = row[key]?.trim();
          if (value) return value;
        }
        return '';
      };
      const items = nodesRef.current;
      const next = [...items];
      const baseX = items.length
        ? Math.min(...items.map((n) => n.position.x))
        : center.x;
      const baseY = items.length
        ? Math.max(...items.map((n) => n.position.y)) + 240
        : center.y;
      for (const row of rows) {
        const name =
          pick(
            row,
            'name',
            'fullname',
            'contactname',
            'contact',
            'employeename',
            'person',
            'displayname'
          ) ||
          [
            pick(row, 'firstname', 'givenname'),
            pick(row, 'lastname', 'surname', 'familyname'),
          ]
            .filter(Boolean)
            .join(' ');
        const email = pick(row, 'email', 'emailaddress', 'mail');
        if (!name && !email) {
          skipped += 1;
          continue;
        }

        const title = pick(
          row,
          'title',
          'jobtitle',
          'position',
          'role',
          'jobrole',
          'designation'
        );
        const department = pick(
          row,
          'department',
          'dept',
          'function',
          'division',
          'businessunit',
          'bu'
        );
        const team = pick(row, 'team', 'subteam', 'squad');
        const productLine = pick(row, 'productline', 'product', 'segment');
        const linkedin = pick(
          row,
          'linkedin',
          'linkedinurl',
          'linkedinprofile',
          'profile',
          'url'
        );
        const notes = pick(row, 'notes', 'note', 'comments', 'description');
        const matchIndex = next.findIndex((node) => {
          const person = node.data.person;
          return (
            (!!email &&
              !!person.email &&
              person.email.toLowerCase() === email.toLowerCase()) ||
            (!!name && person.name.toLowerCase() === name.toLowerCase())
          );
        });
        const enrichment = {
          ...(title ? { title } : {}),
          ...(department ? { department } : {}),
          ...(team ? { team, teamEvidence: 'sourced' as const } : {}),
          ...(productLine ? { productLine } : {}),
          ...(email ? { email } : {}),
          ...(linkedin ? { linkedin } : {}),
        };
        if (matchIndex >= 0) {
          const node = next[matchIndex];
          const person = node.data.person;
          next[matchIndex] = {
            ...node,
            data: {
              ...node.data,
              person: {
                ...person,
                ...enrichment,
                notes: [person.notes, notes].filter(Boolean).join('\n'),
                sources: Array.from(new Set([...(person.sources ?? []), 'CRM CSV'])),
              },
            },
          };
          updated += 1;
          continue;
        }
        const x = baseX + (added % 6) * 300;
        const y = baseY + Math.floor(added / 6) * 260;
        const person: Person = {
          id: crypto.randomUUID(),
          name: name || email,
          title: title || 'CRM contact',
          department: department || null,
          team: team || null,
          productLine: productLine || null,
          teamEvidence: team ? 'sourced' : null,
          role: 'none',
          confidence: 'high',
          sources: ['CRM CSV'],
          researchStatus: 'verified',
          notes,
          email: email || null,
          linkedin: linkedin || null,
          x,
          y,
        };
        next.push({
          id: person.id,
          type: 'person',
          position: { x, y },
          data: { person, readOnly: false },
          style: { width: 250 },
        });
        added += 1;
      }
      const finalNodes =
        added > 0 || lanesChanged(items, next) ? relayLanes(next) : next;
      nodesRef.current = finalNodes;
      setNodes(finalNodes);
      markDirty(finalNodes, edgesRef.current);
      setImportNotice(
        updated + added === 0
          ? 'No usable contacts — the CSV needs a Name or Email column.'
          : `CRM import: ${updated} enriched, ${added} added${skipped ? `, ${skipped} skipped` : ''}.`
      );
      window.setTimeout(() => setImportNotice(''), 5_000);
    },
    [
      edgesRef,
      nodesRef,
      readOnly,
      recordHistory,
      rf,
      setNodes,
      markDirty,
      relayLanes,
      lanesChanged,
      setImportNotice,
    ]
  );

  const mergeResearch = useCallback(
    (result: ResearchResult) => {
      if (readOnly) return { added: 0, enriched: 0 };
      recordHistory();
      const dead = new Set(result.deadSources ?? []);
      const center = rf.screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      });
      const normalizeName = canonicalPersonName;
      const nextNodes = [...nodes];
      let added = 0;
      let enriched = 0;
      const bounds =
        nextNodes.length > 0
          ? {
              minX: Math.min(...nextNodes.map((n) => n.position.x)),
              maxY: Math.max(...nextNodes.map((n) => n.position.y)),
            }
          : null;
      const gridX = bounds ? bounds.minX : center.x;
      const gridY = bounds ? bounds.maxY + 240 : center.y;

      for (const researched of result.people) {
        const matchIndex = nextNodes.findIndex(
          (node) =>
            normalizeName(node.data.person.name) ===
            normalizeName(researched.name)
        );
        if (matchIndex >= 0) {
          const node = nextNodes[matchIndex];
          const person = node.data.person;
          const mergedSourceDetails = Array.from(
            new Map(
              [
                ...(person.sourceDetails ?? []),
                ...researched.sourceDetails,
              ].map((source) => [source.url, source])
            ).values()
          ).filter((s) => !dead.has(s.url));
          const mergedFreshness =
            mergedSourceDetails.length > 0
              ? evidenceFreshness(mergedSourceDetails)
              : researched.freshness;
          nextNodes[matchIndex] = {
            ...node,
            data: {
              ...node.data,
              person: {
                ...person,
                title:
                  !person.title || (person.sources ?? []).length === 0
                    ? researched.title
                    : person.title,
                department: person.department ?? researched.department,
                team: person.team ?? researched.team,
                productLine: person.productLine ?? researched.productLine,
                teamEvidence:
                  person.teamEvidence ?? researched.teamEvidence,
                confidence: researched.confidence,
                sources: Array.from(
                  new Set([
                    ...(person.sources ?? []),
                    ...(researched.sources ?? []),
                    ...(researched.source ? [researched.source] : []),
                  ])
                ).filter((url) => !dead.has(url)),
                sourceDetails: mergedSourceDetails,
                freshness: mergedFreshness,
                corroborationCount:
                  mergedSourceDetails.length > 0
                    ? corroborationCount(mergedSourceDetails)
                    : researched.corroborationCount,
                lastVerifiedAt: researched.lastVerifiedAt,
                conflictingTitles: Array.from(
                  new Set([
                    ...(person.conflictingTitles ?? []),
                    ...researched.conflictingTitles,
                  ])
                ),
                researchStatus:
                  mergedFreshness === 'stale' &&
                  researched.researchStatus === 'verified'
                    ? 'possibly_stale'
                    : researched.researchStatus,
              },
            },
          };
          enriched += 1;
          continue;
        }

        const person: Person = {
          id: crypto.randomUUID(),
          name: researched.name,
          title: researched.title,
          department: researched.department,
          team: researched.team,
          productLine: researched.productLine,
          teamEvidence: researched.teamEvidence,
          role: 'none',
          confidence: researched.confidence,
          sources:
            (researched.sources ?? []).length > 0
              ? (researched.sources ?? [])
              : researched.source
                ? [researched.source]
                : [],
          sourceDetails: researched.sourceDetails,
          freshness: researched.freshness,
          corroborationCount: researched.corroborationCount,
          lastVerifiedAt: researched.lastVerifiedAt,
          conflictingTitles: researched.conflictingTitles,
          researchStatus: researched.researchStatus,
          notes: '',
          email: null,
          linkedin: null,
          x: gridX + (added % 3) * 280,
          y: gridY + Math.floor(added / 3) * 180,
        };
        nextNodes.push({
          id: person.id,
          type: 'person',
          position: { x: person.x, y: person.y },
          data: { person, readOnly: false },
          style: { width: 250 },
        });
        added += 1;
      }

      const idByName = new Map(
        nextNodes.map((node) => [
          normalizeName(node.data.person.name),
          node.id,
        ])
      );
      const nextEdges = [...edges];
      for (const researched of result.people) {
        if (!researched.reportsToName) continue;
        const from = idByName.get(normalizeName(researched.reportsToName));
        const to = idByName.get(normalizeName(researched.name));
        if (
          !from ||
          !to ||
          from === to ||
          nextEdges.some(
            (edge) => edge.data?.kind === 'reports' && edge.target === to
          )
        ) {
          continue;
        }
        nextEdges.push(reportsEdge(from, to));
      }

      const nextMeta = meta
        ? {
            ...meta,
            researchedAt: new Date().toISOString(),
            provider: result.provider,
            refreshCadence: meta.refreshCadence ?? 'weekly',
            nextRefreshAt: new Date(
              Date.now() +
                (meta.refreshCadence === 'monthly' ? 30 : 7) * 86_400_000
            ).toISOString(),
            companyProfile: result.companyProfile ?? meta.companyProfile ?? null,
            initiatives: (
              result.initiatives.length > 0
                ? result.initiatives
                : (meta.initiatives ?? [])
            ).map((initiative) => ({
              ...initiative,
              evidence: (initiative.evidence ?? []).filter(
                (url) => !dead.has(url)
              ),
              evidenceDetails: (initiative.evidenceDetails ?? []).filter(
                (source) => !dead.has(source.url)
              ),
            })),
          }
        : meta;
      // Drop stored citations the server verified as dead, then recompute the
      // displayed provenance for every card — including ones this pass did not
      // return — and clamp evidence labels on people left with no sources.
      for (let i = 0; i < nextNodes.length; i++) {
        const person = nextNodes[i].data.person;
        const sourceDetails = (person.sourceDetails ?? []).filter(
          (s) => !dead.has(s.url)
        );
        const sources = (person.sources ?? []).filter((url) => !dead.has(url));
        const removed =
          sourceDetails.length !== (person.sourceDetails?.length ?? 0) ||
          sources.length !== (person.sources ?? []).length;
        const needsClamp =
          sources.length === 0 &&
          (person.researchStatus === 'verified' ||
            person.confidence === 'high' ||
            person.teamEvidence === 'sourced');
        if (!removed && !needsClamp) continue;
        const freshness = evidenceFreshness(sourceDetails);
        nextNodes[i] = {
          ...nextNodes[i],
          data: {
            ...nextNodes[i].data,
            person: {
              ...person,
              sources,
              sourceDetails,
              freshness,
              corroborationCount: corroborationCount(sourceDetails),
              lastVerifiedAt:
                sources.length > 0 ? new Date().toISOString() : null,
              confidence:
                person.confidence === 'high' && sources.length === 0
                  ? 'medium'
                  : person.confidence,
              teamEvidence:
                person.teamEvidence === 'sourced' && sources.length === 0
                  ? 'inferred'
                  : person.teamEvidence,
              researchStatus:
                person.researchStatus === 'conflicting'
                  ? 'conflicting'
                  : sources.length === 0 || freshness === 'stale'
                    ? 'possibly_stale'
                    : person.researchStatus,
            },
          },
        };
      }
      metaRef.current = nextMeta;
      setMeta(nextMeta);
      const finalNodes =
        added > 0 || lanesChanged(nodes, nextNodes)
          ? relayLanes(nextNodes)
          : nextNodes;
      nodesRef.current = finalNodes;
      edgesRef.current = nextEdges;
      setNodes(finalNodes);
      setEdges(nextEdges);
      markDirty(finalNodes, nextEdges);
      const addedIds = finalNodes.slice(nodes.length).map((node) => node.id);
      if (addedIds.length > 0) {
        window.setTimeout(() => {
          void rf.fitView({
            nodes: finalNodes.filter((node) => addedIds.includes(node.id)),
            padding: 0.5,
            duration: 450,
          });
        }, 50);
      }
      return { added, enriched };
    },
    [
      edgesRef,
      metaRef,
      nodesRef,
      edges,
      markDirty,
      meta,
      nodes,
      readOnly,
      recordHistory,
      relayLanes,
      lanesChanged,
      rf,
      setEdges,
      setMeta,
      setNodes,
    ]
  );

  return {
    exportingAccountPlan,
    exportPng,
    exportAccountPlan,
    importCrmCsv,
    mergeResearch,
  };
}
