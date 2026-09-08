import type { Competitor } from "@/types/seo";

/**
 * The tracked competitive set, ordered by share of visibility.
 *
 * Demo fixtures. Every brand and domain below is invented for the demo and is
 * not intended to refer to any real company.
 */
export const COMPETITORS: readonly Competitor[] = [
  {
    id: "comp-01",
    name: "Northpeak",
    domain: "northpeak.example",
    visibility: 18.4,
    organicTraffic: 412000,
    keywordOverlap: 61,
    authority: 74,
    trend: { value: 2.8 },
  },
  {
    id: "comp-02",
    name: "Cartograph",
    domain: "cartograph.example",
    visibility: 15.2,
    organicTraffic: 338000,
    keywordOverlap: 54,
    authority: 69,
    trend: { value: -1.4 },
  },
  {
    id: "comp-03",
    name: "Bellhaven",
    domain: "bellhaven.example",
    visibility: 12.7,
    organicTraffic: 281000,
    keywordOverlap: 47,
    authority: 66,
    trend: { value: 5.6 },
  },
  {
    id: "comp-04",
    name: "Quantly",
    domain: "quantly.example",
    visibility: 9.8,
    organicTraffic: 196000,
    keywordOverlap: 38,
    authority: 58,
    trend: { value: 0 },
  },
  {
    id: "comp-05",
    name: "Fernbrook",
    domain: "fernbrook.example",
    visibility: 7.4,
    organicTraffic: 154000,
    keywordOverlap: 33,
    authority: 52,
    trend: { value: -3.9 },
  },
  {
    id: "comp-06",
    name: "Havenline",
    domain: "havenline.example",
    visibility: 5.1,
    organicTraffic: 88000,
    keywordOverlap: 21,
    authority: 44,
    trend: { value: 7.2 },
  },
];
