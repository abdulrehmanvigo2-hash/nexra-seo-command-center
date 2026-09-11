"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/table";
import { DEPTH_LIMIT, MIN_INTERNAL_LINKS_IN } from "@/lib/mock/technical";
import {
  CanonicalBadge,
  CwvBadge,
  DepthValue,
  IndexStatusBadge,
  LinksInValue,
  PageLink,
  SchemaBadge,
  ScoreValue,
  SeverityBadge,
  StatusCode,
  toneForScore,
} from "@/components/technical/technical-chrome";
import type { TechnicalPage } from "@/types/technical";

/**
 * The technical page table.
 *
 * Wide on purpose — the columns are the answer to "what is wrong with this
 * URL", and dropping half of them would leave a reader clicking into every row
 * to find out. The less load-bearing columns are hidden below `lg` rather than
 * wrapped, and the whole table scrolls inside its own container so the page
 * itself never does.
 */
export function PagesTable({ pages }: { pages: readonly TechnicalPage[] }) {
  return (
    <Table caption="Published URLs with their technical state">
      <TableHead>
        <TableRow>
          <TableHeaderCell>Page</TableHeaderCell>
          <TableHeaderCell className="hidden lg:table-cell">
            Type
          </TableHeaderCell>
          <TableHeaderCell align="right">Status</TableHeaderCell>
          <TableHeaderCell>Index</TableHeaderCell>
          <TableHeaderCell className="hidden xl:table-cell">
            Canonical
          </TableHeaderCell>
          <TableHeaderCell align="right" className="hidden sm:table-cell">
            Depth
          </TableHeaderCell>
          <TableHeaderCell className="hidden xl:table-cell">CWV</TableHeaderCell>
          <TableHeaderCell className="hidden xl:table-cell">
            Schema
          </TableHeaderCell>
          <TableHeaderCell align="right" className="hidden lg:table-cell">
            Links in
          </TableHeaderCell>
          <TableHeaderCell align="right">Issues</TableHeaderCell>
          <TableHeaderCell className="hidden sm:table-cell">
            Severity
          </TableHeaderCell>
          <TableHeaderCell align="right">Score</TableHeaderCell>
        </TableRow>
      </TableHead>

      <TableBody>
        {pages.map((page) => (
          <TableRow key={page.id}>
            <TableCell header className="max-w-[22rem] min-w-[12rem]">
              <PageLink
                contentId={page.contentId}
                title={page.title}
                path={page.path}
              />
            </TableCell>

            <TableCell className="hidden capitalize lg:table-cell">
              {page.format}
            </TableCell>

            <TableCell numeric>
              <StatusCode status={page.httpStatus} />
            </TableCell>

            <TableCell>
              <IndexStatusBadge status={page.indexStatus} />
            </TableCell>

            <TableCell className="hidden xl:table-cell">
              <CanonicalBadge state={page.canonicalState} />
            </TableCell>

            <TableCell numeric className="hidden sm:table-cell">
              <DepthValue depth={page.crawlDepth} limit={DEPTH_LIMIT} />
            </TableCell>

            <TableCell className="hidden xl:table-cell">
              <CwvBadge state={page.vitals.state} />
            </TableCell>

            <TableCell className="hidden xl:table-cell">
              <SchemaBadge state={page.schemaState} />
            </TableCell>

            <TableCell numeric className="hidden lg:table-cell">
              <LinksInValue
                links={page.internalLinksIn}
                floor={MIN_INTERNAL_LINKS_IN}
              />
            </TableCell>

            <TableCell numeric>{page.issueCount}</TableCell>

            <TableCell className="hidden sm:table-cell">
              <SeverityBadge severity={page.severity} />
            </TableCell>

            <TableCell numeric>
              <ScoreValue
                score={page.score.score}
                label="Technical score"
                tone={toneForScore(page.score.score)}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
