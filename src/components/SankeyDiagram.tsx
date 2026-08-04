import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { sankey, SankeyNodeMinimal } from 'd3-sankey';
import { CashflowItem } from '../types/cashflow';
import { COLORS, getSubcategoryLayoutNodes, processSankeyData, SubcategoryLayoutNode } from '../utils/sankeyUtils';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';

interface SankeyDiagramProps {
  incomes: CashflowItem[];
  expenses: CashflowItem[];
  className?: string;
  /** Item ids currently expanded to show their fourth-column subcategories.
   *  View state only (R-DM-5) — owned by the caller, never serialized. */
  expandedIds: Set<string>;
  onToggleExpand: (itemId: string) => void;
}

/** Node shape after `sankeyGenerator()` has assigned layout fields, typed
 *  against the properties `processSankeyData` puts on every node. */
interface PositionedSankeyNode extends SankeyNodeMinimal<object, object> {
  name: string;
  itemId?: string;
  category: 'income' | 'expense' | 'balance';
  fill: string;
  percentage?: number;
}


/**
 * Explicitly states the denominator ("of Housing"), not just a bare
 * percentage — children show share-of-parent while the parent itself shows
 * share-of-total-budget, and with identical formatting those two different
 * scales read as one and invite summing. Spelling out "of {parent}" makes
 * the denominator unambiguous without relying on styling alone.
 */
const formatSubcategoryLabel = (child: SubcategoryLayoutNode, parentLabel: string): string =>
  `${child.label} — ${child.displayPercentage}% of ${parentLabel}`;

const formatMainLabel = (percentage: number, name: string): string => {
  const pct = percentage < 1 ? '<1' : Math.round(percentage);
  return `${pct}% ${name}`;
};

const SankeyDiagram: React.FC<SankeyDiagramProps> = ({
  incomes,
  expenses,
  className,
  expandedIds,
  onToggleExpand,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const data = processSankeyData(incomes, expenses);
  const isMobile = useIsMobile();

  useEffect(() => {
    if (!svgRef.current || !data.nodes.length) return;

    // Clear previous content
    d3.select(svgRef.current).selectAll('*').remove();

    const expenseById = new Map(expenses.map((expense) => [expense.id, expense]));
    const expandedExpenses = expenses.filter(
      (expense) => expandedIds.has(expense.id) && expense.children && expense.children.length > 0,
    );

    // Fourth-column sizing. Bypasses sankeyGenerator entirely for this part —
    // d3-sankey's automatic depth algorithm assumes a uniform graph, which a
    // partially-expanded budget isn't. Each expanded category instead gets a
    // manually laid-out mini-column, height-matched to that category's own
    // node (rollup guarantees children sum to the parent's height).
    const subNodeWidth = isMobile ? 8 : 14;
    const subLabelOffset = isMobile ? 4 : 8;
    const subFontSize = isMobile ? 8 : 11;
    const mainLabelFontSize = isMobile ? 9 : 12;

    // Expand/collapse badge — a filled circle so it reads as a control
    // regardless of the node's own fill color, placed right against the
    // node it toggles rather than out in the label gap.
    const badgeRadius = isMobile ? 6 : 8;
    const badgeGapFromNode = isMobile ? 3 : 5;
    const badgeToLabelGap = isMobile ? 4 : 6;
    const badgeSpan = badgeGapFromNode + badgeRadius * 2 + badgeToLabelGap;

    // Pre-layout node data (from `processSankeyData`, before `sankeyGenerator`)
    // for expense items specifically — the only category guaranteed an
    // `itemId`, needed to measure each expanded category's own main-column
    // label ahead of laying out its fourth column. The intersection type
    // (rather than a separately declared interface) keeps every field the
    // real union members carry, so it validly narrows `data.nodes`' type.
    type SankeyNodeData = (typeof data.nodes)[number];
    const isExpenseNodeData = (
      node: SankeyNodeData,
    ): node is SankeyNodeData & { itemId: string; percentage: number } => node.category === 'expense';

    const expenseNodeDataById = new Map(
      data.nodes.filter(isExpenseNodeData).map((node) => [node.itemId, node]),
    );

    const measureLayer = d3.select(svgRef.current).append('g').style('visibility', 'hidden');
    const measureTextWidth = (text: string, fontSize: number): number => {
      const textEl = measureLayer.append('text').style('font-size', `${fontSize}px`).text(text);
      const node = textEl.node();
      return node ? node.getBBox().width : 0;
    };

    // The gap before the fourth column must clear each expanded category's
    // own main-column label (drawn at x1 + badge + label gap), or a wide
    // parent label like "28% 🏡 Housing" runs straight into the child
    // column. Measured per category, then the widest one sets a single
    // shared column start so the fourth column reads as one straight edge.
    // Also measures every expanded category's children, not just the first
    // one open, so two categories with long child names opened together
    // both fit without clipping.
    let maxParentLabelWidth = 0;
    let maxChildLabelWidth = 0;
    expandedExpenses.forEach((expense) => {
      const nodeData = expenseNodeDataById.get(expense.id);
      if (nodeData) {
        const parentLabelWidth = measureTextWidth(
          formatMainLabel(nodeData.percentage, nodeData.name),
          mainLabelFontSize,
        );
        maxParentLabelWidth = Math.max(maxParentLabelWidth, parentLabelWidth);
      }

      const parentLabel = nodeData?.name ?? expense.name;
      getSubcategoryLayoutNodes(expense).forEach((child) => {
        const childLabelWidth = measureTextWidth(formatSubcategoryLabel(child, parentLabel), subFontSize);
        maxChildLabelWidth = Math.max(maxChildLabelWidth, childLabelWidth);
      });
    });
    measureLayer.remove();

    const hasExpanded = expandedExpenses.length > 0;
    const subColumnGap = badgeSpan + maxParentLabelWidth + (isMobile ? 16 : 24);

    // Set up dimensions
    const baseMargin = isMobile
      ? { top: 30, right: 50, bottom: 30, left: 50 } // Minimal side margins for mobile
      : { top: 30, right: 180, bottom: 30, left: 180 };
    const extraRight = hasExpanded
      ? subColumnGap + subNodeWidth + subLabelOffset + maxChildLabelWidth + (isMobile ? 12 : 20)
      : 0;
    const margin = { ...baseMargin, right: baseMargin.right + extraRight };
    const width = svgRef.current.clientWidth;
    const height = isMobile ? 450 : 450;
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    // Create the SVG container
    const svg = d3.select(svgRef.current)
      .attr('width', width)
      .attr('height', height)
      .attr('class', 'sankey');

    // Create the main group with margins
    const g = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Set up the Sankey generator
    const sankeyGenerator = sankey()
      .nodeWidth(isMobile ? 10 : 20)
      .nodePadding(isMobile ? 12 : 15)
      .extent([[0, 0], [innerWidth, innerHeight]]);

    // Generate the Sankey data
    const sankeyData = sankeyGenerator({
      nodes: data.nodes.map(node => {
        const isBudget = node.name === 'Budget';
        const nodeData: any = {
          ...node,
          name: node.name.split('\n')[0],
          fill: node.color,
        };

        // Set minimum height for budget node on desktop
        if (!isMobile && isBudget) {
          nodeData.height = Math.max(innerHeight * 0.5, nodeData.height || 0);
        }

        return nodeData;
      }),
      links: data.links
    });

    // Center the budget node vertically
    type PositionedNode = SankeyNodeMinimal<object, object> & { name: string };
    const budgetNode = (sankeyData.nodes as PositionedNode[]).find(n => n.name === 'Budget');
    if (budgetNode) {
      const { y0, y1 } = budgetNode;
      if (typeof y0 === 'number' && typeof y1 === 'number') {
        const centerY = innerHeight / 2;
        const nodeHeight = y1 - y0;
        budgetNode.y0 = centerY - (nodeHeight / 2);
        budgetNode.y1 = centerY + (nodeHeight / 2);

        // Additional adjustments for desktop view
        if (!isMobile) {
          const minHeight = innerHeight * 0.5;
          if (budgetNode.y1 - budgetNode.y0 < minHeight) {
            budgetNode.y0 = centerY - (minHeight / 2);
            budgetNode.y1 = centerY + (minHeight / 2);
          }
        }
      }
    }

    // Create gradients for links
    const defs = svg.append('defs');
    sankeyData.links.forEach((link: any, i) => {
      const gradient = defs.append('linearGradient')
        .attr('id', `gradient-${i}`)
        .attr('gradientUnits', 'userSpaceOnUse')
        .attr('x1', link.source.x1)
        .attr('x2', link.target.x0);

      gradient.append('stop')
        .attr('offset', '0%')
        .attr('stop-color', link.source.fill);

      gradient.append('stop')
        .attr('offset', '100%')
        .attr('stop-color', link.target.fill);
    });

    // Calculate vertical positions for links
    const sourceOffsets: { [key: string]: number } = {};
    const targetOffsets: { [key: string]: number } = {};

    sankeyData.nodes.forEach((node: any) => {
      sourceOffsets[node.index] = node.y0;
      targetOffsets[node.index] = node.y0;
    });

    // Sort links by target node index to maintain consistent ordering
    const sortedLinks = [...sankeyData.links].sort((a: any, b: any) => {
      if (a.target.index !== b.target.index) {
        return a.target.index - b.target.index;
      }
      return b.value - a.value; // For links to the same target, sort by value
    });

    // Custom link path generator that matches node heights
    const createLinkPath = (d: any) => {
      const sourceX = d.source.x1;
      const targetX = d.target.x0;

      // Calculate vertical positions based on accumulated offsets
      const sourceY = sourceOffsets[d.source.index];
      const targetY = targetOffsets[d.target.index];

      // Calculate heights based on the link's value
      const sourceHeight = (d.value / d.source.value) * (d.source.y1 - d.source.y0);
      const targetHeight = (d.value / d.target.value) * (d.target.y1 - d.target.y0);

      // Update offsets for next link
      sourceOffsets[d.source.index] += sourceHeight;
      targetOffsets[d.target.index] += targetHeight;

      // Control points for the curves
      const curvature = isMobile ? 0.2 : 0.5;
      const controlPoint1X = sourceX * (1 - curvature) + targetX * curvature;
      const controlPoint2X = sourceX * curvature + targetX * (1 - curvature);

      return `
        M${sourceX},${sourceY}
        C${controlPoint1X},${sourceY}
         ${controlPoint2X},${targetY}
         ${targetX},${targetY}
        L${targetX},${targetY + targetHeight}
        C${controlPoint2X},${targetY + targetHeight}
         ${controlPoint1X},${sourceY + sourceHeight}
         ${sourceX},${sourceY + sourceHeight}
        Z
      `;
    };

    // Draw the links
    const links = g.append('g')
      .attr('class', 'links')
      .selectAll('path')
      .data(sortedLinks)
      .join('path')
      .attr('class', 'link')
      .attr('d', createLinkPath)
      .attr('fill', (_, i) => `url(#gradient-${i})`)
      .attr('fill-opacity', isMobile ? 0.8 : 0.7)
      .attr('stroke', 'none');

    // Draw the nodes
    const nodeGroups = g.append('g')
      .attr('class', 'nodes')
      .selectAll('g')
      .data(sankeyData.nodes)
      .join('g')
      .attr('class', 'node');

    // Add node rectangles
    nodeGroups.append('rect')
      .attr('x', (d: any) => d.x0)
      .attr('y', (d: any) => d.y0)
      .attr('width', (d: any) => d.x1 - d.x0)
      .attr('height', (d: any) => d.y1 - d.y0)
      .attr('fill', (d: any) => d.fill)
      .attr('fill-opacity', 0.9)
      .attr('rx', 4)
      .attr('ry', 4)
      .style('cursor', (d: any) => (expenseById.get(d.itemId)?.children?.length ? 'pointer' : 'default'))
      .on('click', (_event, d: any) => {
        if (expenseById.get(d.itemId)?.children?.length) {
          onToggleExpand(d.itemId);
        }
      });

    // Add node labels
    nodeGroups.append('text')
      .attr('x', (d: any) => {
        const isBudget = d.name === 'Budget';
        const isLeftSide = sankeyData.nodes.indexOf(d) < sankeyData.nodes.findIndex((n: any) => n.name === 'Budget');
        const hasChildren = !isLeftSide && !!expenseById.get(d.itemId)?.children?.length;
        const labelOffset = hasChildren ? badgeSpan : (isMobile ? 5 : 10);
        return isBudget ? d.x0 + (d.x1 - d.x0) / 2 :
               isLeftSide ? d.x0 - labelOffset : d.x1 + labelOffset;
      })
      .attr('y', (d: any) => d.y0 + (d.y1 - d.y0) / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', (d: any) => {
        const isBudget = d.name === 'Budget';
        const isLeftSide = sankeyData.nodes.indexOf(d) < sankeyData.nodes.findIndex((n: any) => n.name === 'Budget');
        return isBudget ? 'middle' : isLeftSide ? 'end' : 'start';
      })
      .attr('transform', (d: any) => {
        // Tilt labels diagonally on mobile
        if (isMobile) {
          const isBudget = d.name === 'Budget';
          if (isBudget) return ''; // No rotation for budget node

          const isLeftSide = sankeyData.nodes.indexOf(d) < sankeyData.nodes.findIndex((n: any) => n.name === 'Budget');
          // Left side labels tilt up, right side labels tilt down
          const angle = isLeftSide ? 30 : -30; // Slightly less angled for better readability
          return `rotate(${angle}, ${isLeftSide ? d.x0 - 8 : d.x1 + 8}, ${d.y0 + (d.y1 - d.y0) / 2})`;
        }
        return '';
      })
      .attr('class', 'label')
      .style('font-size', isMobile ? '9px' : '12px')
      .style('fill', '#4b5563')
      .text((d: any) => {
        if (d.name === 'Budget') return '';
        // Show "< 1%" for percentages under 1%, otherwise show rounded integer
        const percentage = d.percentage < 1 ? '<1' : Math.round(d.percentage);
        let displayName = d.name;

        if (isMobile) {
          // Trim longer names on mobile
          if (displayName.length > 12) {
            displayName = displayName.substring(0, 10) + '..';
          }
          // Keep on same line but use very compact format
          return `${percentage}%${displayName}`;
        }

        return `${percentage}% ${displayName}`;
      });

    // Adjust text for mobile
    if (isMobile) {
      nodeGroups.selectAll('text')
        .style('font-size', '8px') // Revert to 8px for mobile
        .each(function(d: any) {
          // Add a shadow effect to improve readability now that labels are closer to nodes
          const textElem = d3.select(this);
          const original = textElem.text();

          if (original && original.length > 0) {
            textElem
              .attr('stroke', 'white')
              .attr('stroke-width', '0.8px')
              .attr('paint-order', 'stroke');
          }
        });
    }

    const positionedNodes = sankeyData.nodes as PositionedSankeyNode[];

    // Fourth column: one manually laid-out mini-column per expanded category,
    // positioned against that category's own node — never through
    // sankeyGenerator (see comment above on sizing).
    const nodeByItemId = new Map<string, PositionedSankeyNode>();
    positionedNodes.forEach((node) => {
      if (node.itemId) nodeByItemId.set(node.itemId, node);
    });

    const childPadding = isMobile ? 3 : 4;
    const createSubLinkPath = (sourceX: number, targetX: number, y0: number, y1: number) => {
      const curvature = isMobile ? 0.2 : 0.5;
      const c1 = sourceX * (1 - curvature) + targetX * curvature;
      const c2 = sourceX * curvature + targetX * (1 - curvature);
      return `
        M${sourceX},${y0}
        C${c1},${y0} ${c2},${y0} ${targetX},${y0}
        L${targetX},${y1}
        C${c2},${y1} ${c1},${y1} ${sourceX},${y1}
        Z
      `;
    };

    expandedExpenses.forEach((expense) => {
      const parentNode = nodeByItemId.get(expense.id);
      if (
        !parentNode ||
        typeof parentNode.y0 !== 'number' ||
        typeof parentNode.y1 !== 'number' ||
        typeof parentNode.x1 !== 'number'
      ) {
        return;
      }
      const parentX1 = parentNode.x1;
      const parentY0 = parentNode.y0;
      const parentY1 = parentNode.y1;
      const parentLabel = expenseNodeDataById.get(expense.id)?.name ?? expense.name;

      const children = getSubcategoryLayoutNodes(expense);
      const totalHeight = parentY1 - parentY0;
      const paddingTotal = Math.min(childPadding * Math.max(children.length - 1, 0), totalHeight * 0.3);
      const available = totalHeight - paddingTotal;

      let cursor = parentY0;
      const positionedChildren = children.map((child, i) => {
        const childHeight = (child.percentage / 100) * available;
        const y0 = cursor;
        const y1 = cursor + childHeight;
        cursor = y1 + (i < children.length - 1 ? childPadding : 0);
        return { ...child, y0, y1 };
      });

      const subX0 = parentX1 + subColumnGap;
      const subX1 = subX0 + subNodeWidth;

      const subGroup = g.append('g').attr('class', 'subcategory-group');

      subGroup
        .append('g')
        .attr('class', 'subcategory-links')
        .selectAll('path')
        .data(positionedChildren)
        .join('path')
        .attr('d', (child) => createSubLinkPath(parentX1, subX0, child.y0, child.y1))
        .attr('fill', COLORS.subcategory)
        .attr('fill-opacity', isMobile ? 0.8 : 0.7)
        .attr('stroke', 'none')
        // Not interactive themselves, and their fill spans the gap the
        // expand/collapse badge sits in — must not intercept its clicks.
        .style('pointer-events', 'none');

      const childGroups = subGroup
        .append('g')
        .attr('class', 'subcategory-nodes')
        .selectAll('g')
        .data(positionedChildren)
        .join('g');

      childGroups
        .append('rect')
        .attr('x', subX0)
        .attr('y', (child) => child.y0)
        .attr('width', subNodeWidth)
        .attr('height', (child) => Math.max(child.y1 - child.y0, 0))
        .attr('fill', COLORS.subcategory)
        .attr('fill-opacity', 0.9)
        .attr('rx', 3)
        .attr('ry', 3);

      // Styled distinctly from the parent's own label (lighter, italic) as a
      // second, non-textual cue that these percentages are on a different
      // scale (share-of-category, not share-of-budget) — on top of the
      // "of {parent}" wording itself.
      childGroups
        .append('text')
        .attr('x', subX1 + subLabelOffset)
        .attr('y', (child) => (child.y0 + child.y1) / 2)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'start')
        .style('font-size', `${subFontSize}px`)
        .style('font-style', 'italic')
        .style('fill', '#6b7280')
        .text((child) => formatSubcategoryLabel(child, parentLabel));
    });

    // Expand/collapse badge — only on expense nodes with children (R-DM-4).
    // Appended to `g` directly, as its own layer *after* the fourth-column
    // pass above, rather than nested inside each node's own <g> (which was
    // created earlier and therefore always painted, and hit-tested, under
    // the subcategory links/rects it can visually overlap — the previous
    // draw order made an expanded category's own badge unclickable). A
    // filled circle immediately to the right of the node it controls, so it
    // reads as attached to that node rather than floating in the label gap,
    // plus a hover cursor on the whole badge group as the interactivity cue.
    const badgeableNodes = positionedNodes.filter(
      (node) => node.itemId && (expenseById.get(node.itemId)?.children?.length ?? 0) > 0,
    );
    const badgeLayer = g.append('g').attr('class', 'expand-badges');
    const badgeGroups = badgeLayer
      .selectAll('g')
      .data(badgeableNodes)
      .join('g')
      .attr('class', 'expand-badge')
      .style('cursor', 'pointer')
      .on('click', (_event, d) => {
        if (d.itemId) onToggleExpand(d.itemId);
      });

    badgeGroups
      .append('circle')
      .attr('cx', (d) => (d.x1 ?? 0) + badgeGapFromNode + badgeRadius)
      .attr('cy', (d) => (d.y0 ?? 0) + ((d.y1 ?? 0) - (d.y0 ?? 0)) / 2)
      .attr('r', badgeRadius)
      .attr('fill', '#4b5563')
      .attr('fill-opacity', 0.9);

    badgeGroups
      .append('text')
      .attr('x', (d) => (d.x1 ?? 0) + badgeGapFromNode + badgeRadius)
      .attr('y', (d) => (d.y0 ?? 0) + ((d.y1 ?? 0) - (d.y0 ?? 0)) / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', 'middle')
      .style('font-size', isMobile ? '8px' : '10px')
      .style('fill', 'white')
      .text((d) => (d.itemId && expandedIds.has(d.itemId) ? '−' : '+'));

  }, [data, incomes, expenses, isMobile, expandedIds, onToggleExpand]);

  return (
    <div className={cn("w-full mt-6", className)} style={{ height: isMobile ? 450 : 450 }}>
      {data.nodes.length > 0 ? (
        <div className="flex justify-center">
          <div className="w-full max-w-[1200px]">
            <svg ref={svgRef} style={{ width: '100%', height: '100%', overflow: 'visible' }} />
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-center h-full bg-secondary/30 rounded-xl">
          <p className="text-muted-foreground text-center">
            Add income and expense items to visualize your cash flow
          </p>
        </div>
      )}
    </div>
  );
};

export default SankeyDiagram;
