import assert from "node:assert/strict";
import { normalizeTravelQuery, buildTravelSearchPlan, normalizeTravelRows } from "../src/travel.js";

const query = normalizeTravelQuery({
  category: "all",
  origin: "RIX",
  destination: "TFS",
  departDate: "2027-02-02",
  returnDate: "2027-02-16",
  adults: 10,
  rooms: 1,
  currency: "EUR",
  maxProviders: 30
});

assert.equal(query.stayNights, 14);
assert.equal(query.adults, 10);

const plan = buildTravelSearchPlan(query);
const categories = new Set(plan.providers.map((x) => x.category));
for (const category of ["flights", "stays", "cars", "activities"]) {
  assert.ok(categories.has(category), "missing provider category: " + category);
}

const rows = normalizeTravelRows([
  {
    provider: "User Live",
    providerId: "test-stay-total",
    category: "stays",
    title: "Example House",
    price: 1557,
    currency: "EUR",
    priceBasis: "total_stay",
    url: "https://example.com/house",
    rawText: "€1557 total"
  },
  {
    provider: "Nightly",
    providerId: "test-stay-night",
    category: "stays",
    title: "Nightly House",
    price: 120,
    currency: "EUR",
    priceBasis: "per_night",
    url: "https://example.org/house",
    rawText: "€120 per night"
  },
  {
    provider: "Flight",
    providerId: "test-flight",
    category: "flights",
    title: "RIX TFS",
    price: 170,
    currency: "EUR",
    priceBasis: "per_person",
    url: "https://flights.example/route",
    rawText: "€170 per person"
  },
  {
    provider: "Unknown",
    providerId: "test-unknown",
    category: "stays",
    title: "Unknown basis",
    price: 80,
    currency: "EUR",
    priceBasis: "unknown",
    url: "https://unknown.example/",
    rawText: "€80"
  }
], query);

const totalStay = rows.find((x) => x.providerId === "test-stay-total");
assert.equal(totalStay.comparableTotal, 1557);
assert.equal(totalStay.comparablePerPerson, 155.7);

const nightly = rows.find((x) => x.providerId === "test-stay-night");
assert.equal(nightly.comparableTotal, 1680);
assert.equal(nightly.comparablePerPerson, 168);

const flight = rows.find((x) => x.providerId === "test-flight");
assert.equal(flight.comparableTotal, 1700);
assert.equal(flight.comparablePerPerson, 170);

const unknown = rows.find((x) => x.providerId === "test-unknown");
assert.equal(unknown.comparableTotal, null);

console.log("Travel Meta normalization tests passed.");
