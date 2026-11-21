import type { FindingsView, SiteCardView, SiteSectionView } from "lianlian/native";

/** One abnormal muscle region, in the viewer's `{ siteId, side }` shape. */
export interface HighlightSite {
  siteId: string;
  side: string | null;
}

/** One axis chip the viewer renders verbatim. */
export interface ViewerAxis {
  axis: string;
  label: string;
  value: string | null;
  measured: boolean;
  abnormal: boolean;
}

/**
 * One archive card pushed to the detail sheet. The viewer does not know the
 * domain wording, so `worst` arrives already composed on this side.
 */
export interface ViewerCard {
  siteId: string;
  siteZh: string;
  side: string | null;
  sideZh: string | null;
  /** Muscle region id / label; both are empty for non-muscle data. */
  groupId: string;
  groupZh: string;
  axes: ViewerAxis[];
  at: number;
  resolved: boolean;
  worst: string;
}

/** Theme colors pushed from the app; the viewer keeps its own fallback. */
export interface HighlightPalette {
  left: string;
  right: string;
  abnormal: string;
  selected: string;
}

/** Camera snapshot owned by the viewer; the app only carries it across pages. */
export interface ViewerCameraSnapshot {
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
  fov: number;
  near: number;
  far: number;
  minDistance: number;
  maxDistance: number;
}

/** The camera and state "show all" must restore after leaving isolation. */
export interface SavedViewerSnapshot {
  camera: ViewerCameraSnapshot | null;
  view: string;
  preset: string;
  selectedSite: string | null;
  selectedSide: string | null;
}

/** The only 3D state kept across pages; it lives in memory for one session. */
export interface ViewerSnapshot {
  camera: ViewerCameraSnapshot | null;
  view: string;
  preset: string;
  selectedSite: string | null;
  selectedSide: string | null;
  isolate: boolean;
  saved: SavedViewerSnapshot | null;
}

export interface SectionFocus {
  sectionId: string;
  focusSlug: string;
}

let savedViewerState: ViewerSnapshot | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Keep the last valid viewer snapshot for this process only. */
export function rememberViewerState(snapshot: unknown): boolean {
  if (!isRecord(snapshot)) {
    return false;
  }
  savedViewerState = snapshot as unknown as ViewerSnapshot;
  return true;
}

export function savedViewerSnapshot(): ViewerSnapshot | null {
  return savedViewerState;
}

export function clearSavedViewerState(): void {
  savedViewerState = null;
}

function cardIsAbnormal(card: SiteCardView): boolean {
  return card.axes.some((axis) => axis.abnormal);
}

function normalSide(side: string | null | undefined): string | null {
  return side === "left" || side === "right" ? side : null;
}

/** Same wording as the archive root and region pages. */
export function cardWorstText(card: SiteCardView): string {
  const axis = card.axes.find((each) => each.abnormal);
  if (!axis) {
    return "状态平稳";
  }
  return `${card.siteZh}${card.sideZh ?? ""} · ${axis.label} ${axis.value}`;
}

/**
 * The viewer only receives muscle abnormalities. Bones stay in the archive
 * views; a `null` side means the midline / both sides.
 */
export function deriveAbnormalSites(
  view: Pick<FindingsView, "sections">,
): HighlightSite[] {
  const sites: HighlightSite[] = [];
  const seen = new Set<string>();

  for (const section of view.sections) {
    if (section.kind !== "muscle") {
      continue;
    }
    for (const card of section.cards) {
      if (!cardIsAbnormal(card)) {
        continue;
      }
      const side = normalSide(card.side);
      const key = `${card.site}\u0000${side ?? ""}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      sites.push({ siteId: card.site, side });
    }
  }

  return sites;
}

/**
 * All muscle cards, one per `site + side`. Bones keep their archive cards out
 * of the 3D sheet; an empty archive or a read failure produces no cards.
 */
export function deriveCards(
  view: Pick<FindingsView, "sections">,
): ViewerCard[] {
  const cards: ViewerCard[] = [];
  const seen = new Set<string>();

  for (const section of view.sections) {
    if (section.kind !== "muscle") {
      continue;
    }
    for (const card of section.cards) {
      const side = normalSide(card.side);
      const key = `${card.site}\u0000${side ?? ""}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      cards.push({
        siteId: card.site,
        siteZh: card.siteZh,
        side,
        sideZh: card.sideZh ?? null,
        groupId: section.id,
        groupZh: section.label,
        axes: card.axes.map((axis) => ({
          axis: axis.axis,
          label: axis.label,
          value: axis.value ?? null,
          measured: axis.measured,
          abnormal: axis.abnormal,
        })),
        at: card.at,
        resolved: card.resolved,
        worst: cardWorstText(card),
      });
    }
  }

  return cards;
}

/**
 * Find the muscle region that owns a site. Same-side cards win; a midline card
 * is the fallback for one-sided picks. The focus slug follows the viewer's
 * selection, so the region page can expand the exact card the user came from.
 */
export function sectionForSite(
  view: Pick<FindingsView, "sections"> | undefined,
  siteId: string | null | undefined,
  side: string | null | undefined,
): SectionFocus | null {
  if (!view || typeof siteId !== "string" || !siteId) {
    return null;
  }

  const wanted = side === "left" || side === "right" ? side : null;
  const focusSlug = wanted ? `${siteId}-${wanted}` : siteId;
  const sections = view.sections.filter((section) => section.kind === "muscle");
  const hasCard = (
    section: SiteSectionView,
    cardSide: string | null,
  ) => section.cards.some(
    (card) => card.site === siteId && normalSide(card.side) === cardSide,
  );

  const section = (wanted ? sections.find((each) => hasCard(each, wanted)) : undefined)
    ?? (wanted ? sections.find((each) => hasCard(each, null)) : undefined)
    ?? sections.find((each) => each.cards.some((card) => card.site === siteId));

  return section ? { sectionId: section.id, focusSlug } : null;
}

/**
 * Build the evaluate script. It waits for the viewer module to publish
 * `setHighlight`, so an early `onLoad` cannot race the module setup.
 */
export function highlightScript(
  palette: HighlightPalette,
  sites: HighlightSite[],
  cards: ViewerCard[],
): string {
  return `(function () {
    const payload = ${JSON.stringify({ palette, sites, cards })};
    return new Promise((resolve) => {
      let tries = 0;
      const attempt = () => {
        if (window.__viewer && typeof window.__viewer.setHighlight === "function") {
          try {
            resolve(window.__viewer.setHighlight(payload));
          } catch (error) {
            resolve(false);
          }
          return;
        }
        tries += 1;
        if (tries > 120) {
          resolve(false);
          return;
        }
        setTimeout(attempt, 50);
      };
      attempt();
    });
  })()`;
}

/** Export the viewer's camera and UI state before leaving the 3D page. */
export function exportStateScript(): string {
  return `(function () {
    return new Promise((resolve) => {
      let tries = 0;
      const attempt = () => {
        if (window.__viewer && typeof window.__viewer.exportState === "function") {
          try {
            resolve(window.__viewer.exportState());
          } catch (error) {
            resolve(null);
          }
          return;
        }
        tries += 1;
        if (tries > 120) {
          resolve(null);
          return;
        }
        setTimeout(attempt, 50);
      };
      attempt();
    });
  })()`;
}

/**
 * Restore before pushing highlights. The viewer queues this itself when the
 * model is still loading, so the first body framing never runs.
 */
export function restoreStateScript(snapshot: ViewerSnapshot): string {
  return `(function () {
    const snapshot = ${JSON.stringify(snapshot)};
    return new Promise((resolve) => {
      let tries = 0;
      const attempt = () => {
        if (window.__viewer && typeof window.__viewer.restoreState === "function") {
          try {
            resolve(window.__viewer.restoreState(snapshot));
          } catch (error) {
            resolve(false);
          }
          return;
        }
        tries += 1;
        if (tries > 120) {
          resolve(false);
          return;
        }
        setTimeout(attempt, 50);
      };
      attempt();
    });
  })()`;
}
