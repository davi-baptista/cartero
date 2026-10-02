/** Existing right-side drawer width variants. Values intentionally mirror current rendered widths. */
export const DRAWER_WIDTH_COMPACT = 'sm:max-w-md'
export const DRAWER_WIDTH_WIDE = 'sm:max-w-lg'

/** One scroll owner with the shared compact scrollbar used across drawers. */
export const DRAWER_SCROLL_REGION_CLASS =
  'min-h-0 flex-1 overflow-y-auto overscroll-contain subtle-scrollbar'

/** Shared horizontal axes for wide drawers with edge-to-edge scroll regions. */
export const DRAWER_WIDE_CONTENT_INSET = 'px-4'
export const DRAWER_WIDE_CONTENT_GUTTER = 'mx-4'

/** Existing vertical relationships used by the approved wide drawers. */
export const DRAWER_WIDE_VERTICAL_RHYTHM = {
  headerContentGap: 'gap-5',
  sectionTopGap: 'gap-5',
  sectionContentGap: 'gap-2',
  sectionHeadingPadding: 'pt-2.5 pb-0',
  sectionEmptyPadding: 'pt-0 pb-6',
  outlineContentGap: 'mt-3',
} as const
