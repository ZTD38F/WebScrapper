const DEFAULT_CURRENCY = "EUR";

function clean(value) {
  return String(value ?? "").trim();
}

function asInt(value, fallback, min = 1, max = 99) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function isoDate(value) {
  const s = clean(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "";
  const d = new Date(s + "T00:00:00Z");
  return Number.isNaN(d.getTime()) ? "" : s;
}

function daysBetween(a, b) {
  if (!a || !b) return 0;
  const ms = new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z");
  return Math.max(0, Math.round(ms / 86400000));
}

function yyMMdd(value) {
  const d = isoDate(value);
  return d ? d.slice(2).replaceAll("-", "") : "";
}

function q(value) {
  return encodeURIComponent(clean(value));
}

function originCode(value) {
  return clean(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function destinationForPath(value) {
  return clean(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

export function normalizeTravelQuery(input = {}) {
  const category = ["all", "flights", "stays", "cars", "activities"].includes(input.category)
    ? input.category
    : "all";
  const departDate = isoDate(input.departDate);
  const returnDate = isoDate(input.returnDate);
  const destination = clean(input.destination);
  const origin = clean(input.origin);
  if (!destination) throw new Error("Travel Meta needs a destination");
  if ((category === "all" || category === "flights") && !origin) {
    throw new Error("Origin is required for flight search");
  }
  if ((category === "all" || category !== "activities") && !departDate) {
    throw new Error("Departure/check-in date is required");
  }
  if ((category === "all" || ["flights", "stays", "cars"].includes(category)) && !returnDate) {
    throw new Error("Return/check-out date is required");
  }
  if (departDate && returnDate && returnDate < departDate) {
    throw new Error("Return/check-out date must not be before departure/check-in");
  }

  return {
    category,
    origin,
    destination,
    departDate,
    returnDate,
    adults: asInt(input.adults, 2, 1, 20),
    rooms: asInt(input.rooms, 1, 1, 10),
    currency: clean(input.currency || DEFAULT_CURRENCY).toUpperCase().slice(0, 3) || DEFAULT_CURRENCY,
    locale: clean(input.locale || "en-US"),
    maxProviders: asInt(input.maxProviders, 12, 1, 30),
    stayNights: daysBetween(departDate, returnDate),
    tripDays: Math.max(1, daysBetween(departDate, returnDate))
  };
}

const providers = [
  {
    id: "google-flights",
    name: "Google Flights",
    category: "flights",
    build: (x) => "https://www.google.com/travel/flights?hl=en&q=" + q(
      "Flights from " + x.origin + " to " + x.destination + " on " + x.departDate +
      (x.returnDate ? " returning " + x.returnDate : "") + " for " + x.adults + " adults"
    )
  },
  {
    id: "skyscanner",
    name: "Skyscanner",
    category: "flights",
    build: (x) => {
      const from = originCode(x.origin).toLowerCase();
      const to = originCode(x.destination).toLowerCase();
      if (/^[a-z]{3}$/.test(from) && /^[a-z]{3}$/.test(to)) {
        return "https://www.skyscanner.net/transport/flights/" + from + "/" + to + "/" +
          yyMMdd(x.departDate) + "/" + yyMMdd(x.returnDate) +
          "/?adultsv2=" + x.adults + "&currency=" + q(x.currency);
      }
      return "https://www.skyscanner.net/transport/flights/?query=" + q(
        x.origin + " " + x.destination + " " + x.departDate + " " + x.returnDate
      );
    }
  },
  {
    id: "kayak-flights",
    name: "KAYAK Flights",
    category: "flights",
    build: (x) => "https://www.kayak.com/flights/" +
      q(originCode(x.origin) || x.origin) + "-" + q(originCode(x.destination) || x.destination) + "/" +
      x.departDate + "/" + x.returnDate + "/" + x.adults + "adults?sort=bestflight_a"
  },
  {
    id: "momondo",
    name: "momondo",
    category: "flights",
    build: (x) => "https://www.momondo.com/flight-search/" +
      q(originCode(x.origin) || x.origin) + "-" + q(originCode(x.destination) || x.destination) + "/" +
      x.departDate + "/" + x.returnDate + "/" + x.adults + "adults?sort=bestflight_a"
  },
  {
    id: "booking-stays",
    name: "Booking.com",
    category: "stays",
    build: (x) => "https://www.booking.com/searchresults.html?ss=" + q(x.destination) +
      "&checkin=" + x.departDate + "&checkout=" + x.returnDate +
      "&group_adults=" + x.adults + "&no_rooms=" + x.rooms +
      "&selected_currency=" + q(x.currency)
  },
  {
    id: "airbnb",
    name: "Airbnb",
    category: "stays",
    build: (x) => "https://www.airbnb.com/s/" + q(x.destination) +
      "/homes?date_picker_type=calendar&checkin=" + x.departDate + "&checkout=" + x.returnDate +
      "&adults=" + x.adults
  },
  {
    id: "vrbo",
    name: "Vrbo",
    category: "stays",
    build: (x) => "https://www.vrbo.com/searchResults.html?destination=" + q(x.destination) +
      "&startDate=" + x.departDate + "&endDate=" + x.returnDate + "&adults=" + x.adults
  },
  {
    id: "hometogo",
    name: "HomeToGo",
    category: "stays",
    build: (x) => "https://www.hometogo.com/search/?location=" + q(x.destination) +
      "&arrival=" + x.departDate + "&departure=" + x.returnDate + "&adults=" + x.adults
  },
  {
    id: "holidu",
    name: "Holidu",
    category: "stays",
    build: (x) => "https://www.holidu.com/search?location=" + q(x.destination) +
      "&checkin=" + x.departDate + "&checkout=" + x.returnDate + "&adults=" + x.adults
  },
  {
    id: "google-hotels",
    name: "Google Hotels",
    category: "stays",
    build: (x) => "https://www.google.com/travel/hotels/" + q(x.destination) +
      "?q=" + q(x.destination + " hotels") + "&checkin=" + x.departDate +
      "&checkout=" + x.returnDate + "&adults=" + x.adults + "&hl=en"
  },
  {
    id: "kayak-hotels",
    name: "KAYAK Stays",
    category: "stays",
    build: (x) => "https://www.kayak.com/hotels/" + destinationForPath(x.destination) +
      "/" + x.departDate + "/" + x.returnDate + "/" + x.adults + "adults"
  },
  {
    id: "discovercars",
    name: "DiscoverCars",
    category: "cars",
    build: (x) => "https://www.discovercars.com/search?location=" + q(x.destination) +
      "&pickupDate=" + x.departDate + "&dropoffDate=" + x.returnDate
  },
  {
    id: "booking-cars",
    name: "Booking Cars",
    category: "cars",
    build: (x) => "https://www.booking.com/cars/index.html?aid=304142&label=travel-meta&selected_currency=" +
      q(x.currency) + "&search=" + q(x.destination + " " + x.departDate + " " + x.returnDate)
  },
  {
    id: "kayak-cars",
    name: "KAYAK Cars",
    category: "cars",
    build: (x) => "https://www.kayak.com/cars/" + q(x.destination) + "/" +
      x.departDate + "/" + x.returnDate
  },
  {
    id: "rentalcars",
    name: "Rentalcars.com",
    category: "cars",
    build: (x) => "https://www.rentalcars.com/SearchResults.do?searchType=all&dropCountry=&doYear=" +
      x.departDate.slice(0, 4) + "&doMonth=" + Number(x.departDate.slice(5, 7)) +
      "&doDay=" + Number(x.departDate.slice(8, 10)) + "&puYear=" + x.returnDate.slice(0, 4) +
      "&puMonth=" + Number(x.returnDate.slice(5, 7)) + "&puDay=" + Number(x.returnDate.slice(8, 10)) +
      "&location=" + q(x.destination)
  },
  {
    id: "getyourguide",
    name: "GetYourGuide",
    category: "activities",
    build: (x) => "https://www.getyourguide.com/s/?q=" + q(x.destination) +
      (x.departDate ? "&date_from=" + x.departDate : "") +
      (x.returnDate ? "&date_to=" + x.returnDate : "")
  },
  {
    id: "viator",
    name: "Viator",
    category: "activities",
    build: (x) => "https://www.viator.com/searchResults/all?text=" + q(x.destination)
  },
  {
    id: "tripadvisor",
    name: "Tripadvisor Things to Do",
    category: "activities",
    build: (x) => "https://www.tripadvisor.com/Search?q=" + q(x.destination + " things to do")
  }
];

export function buildTravelSearchPlan(input) {
  const query = normalizeTravelQuery(input);
  const allowed = query.category === "all"
    ? new Set(["flights", "stays", "cars", "activities"])
    : new Set([query.category]);

  const selected = providers
    .filter((provider) => allowed.has(provider.category))
    .slice(0, query.maxProviders)
    .map((provider) => ({
      id: provider.id,
      name: provider.name,
      category: provider.category,
      url: provider.build(query)
    }));

  return { query, providers: selected };
}

function parseDisplayedPrice(text) {
  const s = clean(text).replace(/\u00a0/g, " ");
  const patterns = [
    { code: "EUR", rx: /(?:€\s*([\d][\d\s.,]*)|([\d][\d\s.,]*)\s*€|EUR\s*([\d][\d\s.,]*)|([\d][\d\s.,]*)\s*EUR)/i },
    { code: "USD", rx: /(?:US\$\s*([\d][\d\s.,]*)|\$\s*([\d][\d\s.,]*)|USD\s*([\d][\d\s.,]*)|([\d][\d\s.,]*)\s*USD)/i },
    { code: "GBP", rx: /(?:£\s*([\d][\d\s.,]*)|GBP\s*([\d][\d\s.,]*)|([\d][\d\s.,]*)\s*GBP)/i }
  ];

  for (const p of patterns) {
    const m = s.match(p.rx);
    if (!m) continue;
    const raw = m.slice(1).find(Boolean);
    if (!raw) continue;
    let n = raw.replace(/\s/g, "");
    const lastComma = n.lastIndexOf(",");
    const lastDot = n.lastIndexOf(".");
    if (lastComma >= 0 && lastDot >= 0) {
      if (lastComma > lastDot) n = n.replaceAll(".", "").replace(",", ".");
      else n = n.replaceAll(",", "");
    } else if (lastComma >= 0) {
      const decimals = n.length - lastComma - 1;
      n = decimals === 2 ? n.replace(",", ".") : n.replaceAll(",", "");
    } else if (lastDot >= 0) {
      const decimals = n.length - lastDot - 1;
      if (decimals === 3 && n.length > 4) n = n.replaceAll(".", "");
    }
    const value = Number(n);
    if (Number.isFinite(value) && value > 0) return { amount: value, currency: p.code, matched: m[0] };
  }
  return null;
}

function detectBasis(category, text) {
  const s = clean(text).toLowerCase();
  if (/(per night|\/night|a night|за ночь|par nakti|pro nacht)/i.test(s)) return "per_night";
  if (/(per day|\/day|a day|за день|par dienu|pro tag)/i.test(s)) return "per_day";
  if (/(per person|\/person|each|за человека|на человека|par personu)/i.test(s)) return "per_person";
  if (/(total|for \d+ nights|за \d+ ноч|итого|kopā|gesamt)/i.test(s)) return category === "cars" ? "total_rental" : "total_stay";
  if (category === "flights" || category === "activities") return "per_person";
  return "unknown";
}

function comparableTotal(row, query) {
  const amount = Number(row.price);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (row.category === "flights") {
    return row.priceBasis === "per_person" ? amount * query.adults : null;
  }
  if (row.category === "stays") {
    if (row.priceBasis === "total_stay") return amount;
    if (row.priceBasis === "per_night" && query.stayNights) return amount * query.stayNights;
    return null;
  }
  if (row.category === "cars") {
    if (row.priceBasis === "total_rental") return amount;
    if (row.priceBasis === "per_day" && query.tripDays) return amount * query.tripDays;
    return null;
  }
  if (row.category === "activities") {
    return row.priceBasis === "per_person" ? amount * query.adults : null;
  }
  return null;
}

function normalizedTitle(value) {
  return clean(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(hotel|apartment|apartments|villa|flight|car|rental|book|deal)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupe(rows) {
  const map = new Map();
  for (const row of rows) {
    const title = normalizedTitle(row.title);
    const host = (() => {
      try { return new URL(row.url).hostname.replace(/^www\./, ""); } catch { return ""; }
    })();
    const key = [row.category, title || row.rawText?.slice(0, 80), Math.round(Number(row.price) || 0), host].join("|");
    const existing = map.get(key);
    if (!existing || (row.confidence || 0) > (existing.confidence || 0)) map.set(key, row);
  }
  return Array.from(map.values());
}

export function normalizeTravelRows(rawRows, query) {
  const normalized = rawRows.map((raw, index) => {
    const price = Number(raw.price);
    const row = {
      id: raw.id || crypto.randomUUID(),
      category: clean(raw.category),
      provider: clean(raw.provider),
      providerId: clean(raw.providerId),
      title: clean(raw.title) || clean(raw.provider) + " result " + (index + 1),
      price: Number.isFinite(price) ? price : null,
      currency: clean(raw.currency || query.currency).toUpperCase(),
      priceBasis: clean(raw.priceBasis || "unknown"),
      comparableTotal: null,
      comparablePerPerson: null,
      rating: Number.isFinite(Number(raw.rating)) ? Number(raw.rating) : null,
      url: clean(raw.url),
      sourceUrl: clean(raw.sourceUrl),
      rawText: clean(raw.rawText).slice(0, 1200),
      confidence: Math.max(0, Math.min(1, Number(raw.confidence) || 0.4))
    };
    row.comparableTotal = comparableTotal(row, query);
    if (row.comparableTotal != null && query.adults > 0) {
      row.comparablePerPerson = Math.round((row.comparableTotal / query.adults) * 100) / 100;
    }
    return row;
  }).filter((row) => row.price != null);

  return dedupe(normalized).sort((a, b) => {
    const at = a.comparableTotal;
    const bt = b.comparableTotal;
    if (at != null && bt != null && at !== bt) return at - bt;
    if (at != null && bt == null) return -1;
    if (at == null && bt != null) return 1;
    if (a.price !== b.price) return a.price - b.price;
    return (b.confidence || 0) - (a.confidence || 0);
  });
}

export function extractTravelCandidatesInPage(options = {}) {
  const provider = String(options.provider || "");
  const providerId = String(options.providerId || "");
  const category = String(options.category || "");
  const maxResults = Math.max(1, Math.min(80, Number(options.maxResults) || 35));

  const cleanText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
  const visible = (el) => {
    if (!(el instanceof Element)) return false;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const priceRe = /(?:€\s*[\d][\d\s.,]*|[\d][\d\s.,]*\s*€|EUR\s*[\d][\d\s.,]*|[\d][\d\s.,]*\s*EUR|US\$\s*[\d][\d\s.,]*|\$\s*[\d][\d\s.,]*|USD\s*[\d][\d\s.,]*|£\s*[\d][\d\s.,]*|GBP\s*[\d][\d\s.,]*)/i;

  const parsePrice = (text) => {
    const s = cleanText(text).replace(/\u00a0/g, " ");
    const patterns = [
      ["EUR", /(?:€\s*([\d][\d\s.,]*)|([\d][\d\s.,]*)\s*€|EUR\s*([\d][\d\s.,]*)|([\d][\d\s.,]*)\s*EUR)/i],
      ["USD", /(?:US\$\s*([\d][\d\s.,]*)|\$\s*([\d][\d\s.,]*)|USD\s*([\d][\d\s.,]*)|([\d][\d\s.,]*)\s*USD)/i],
      ["GBP", /(?:£\s*([\d][\d\s.,]*)|GBP\s*([\d][\d\s.,]*)|([\d][\d\s.,]*)\s*GBP)/i]
    ];
    for (const [currency, rx] of patterns) {
      const m = s.match(rx);
      if (!m) continue;
      const raw = m.slice(1).find(Boolean);
      if (!raw) continue;
      let n = raw.replace(/\s/g, "");
      const lastComma = n.lastIndexOf(",");
      const lastDot = n.lastIndexOf(".");
      if (lastComma >= 0 && lastDot >= 0) {
        n = lastComma > lastDot ? n.replaceAll(".", "").replace(",", ".") : n.replaceAll(",", "");
      } else if (lastComma >= 0) {
        n = n.length - lastComma - 1 === 2 ? n.replace(",", ".") : n.replaceAll(",", "");
      } else if (lastDot >= 0 && n.length - lastDot - 1 === 3 && n.length > 4) {
        n = n.replaceAll(".", "");
      }
      const amount = Number(n);
      if (Number.isFinite(amount) && amount > 0 && amount < 10000000) {
        return { amount, currency, matched: m[0] };
      }
    }
    return null;
  };

  const detectBasisLocal = (text) => {
    const s = cleanText(text).toLowerCase();
    if (/(per night|\/night|a night|за ночь|par nakti|pro nacht)/i.test(s)) return "per_night";
    if (/(per day|\/day|a day|за день|par dienu|pro tag)/i.test(s)) return "per_day";
    if (/(per person|\/person|each|за человека|на человека|par personu)/i.test(s)) return "per_person";
    if (/(total|for \d+ nights|за \d+ ноч|итого|kopā|gesamt)/i.test(s)) return category === "cars" ? "total_rental" : "total_stay";
    if (category === "flights" || category === "activities") return "per_person";
    return "unknown";
  };

  const nearestCard = (el) => {
    let current = el;
    let best = el;
    for (let i = 0; i < 6 && current; i += 1, current = current.parentElement) {
      const text = cleanText(current.innerText || current.textContent);
      if (text.length >= 35 && text.length <= 1600) best = current;
      if (current.matches?.("article,li,[role='listitem'],[data-testid*='card'],[class*='card'],[class*='result']")) {
        return current;
      }
    }
    return best;
  };

  const titleFrom = (card, priceMatched) => {
    const selectors = "h1,h2,h3,h4,[role='heading'],[data-testid*='title'],[class*='title'],a[aria-label]";
    for (const el of card.querySelectorAll?.(selectors) || []) {
      const t = cleanText(el.getAttribute?.("aria-label") || el.innerText || el.textContent);
      if (t && t.length >= 3 && t.length <= 180 && !priceRe.test(t)) return t;
    }
    const lines = String(card.innerText || card.textContent || "").split(/\n+/).map(cleanText).filter(Boolean);
    return lines.find((line) => line.length >= 3 && line.length <= 180 && !line.includes(priceMatched) && !priceRe.test(line)) || "";
  };

  const linkFrom = (card, el) => {
    const anchor = el.closest?.("a[href]") || card.querySelector?.("a[href]");
    if (!anchor?.href) return location.href;
    try { return new URL(anchor.href, location.href).href; } catch { return location.href; }
  };

  const ratingFrom = (text) => {
    const patterns = [
      /(?:rated?|rating|review score|оценка)\s*[:\-]?\s*(\d(?:[.,]\d)?|10)\s*(?:\/\s*10)?/i,
      /\b(\d(?:[.,]\d)?)\s*\/\s*10\b/
    ];
    for (const rx of patterns) {
      const m = text.match(rx);
      if (!m) continue;
      const n = Number(String(m[1]).replace(",", "."));
      if (Number.isFinite(n) && n >= 0 && n <= 10) return n;
    }
    return null;
  };

  const candidates = [];
  const seen = new Set();
  const nodes = Array.from(document.querySelectorAll("span,div,p,strong,b,a,button"));
  for (const el of nodes) {
    if (!visible(el)) continue;
    const own = cleanText(el.innerText || el.textContent);
    if (!own || own.length > 220 || !priceRe.test(own)) continue;
    const parsed = parsePrice(own);
    if (!parsed) continue;
    const card = nearestCard(el);
    const rawText = cleanText(card.innerText || card.textContent).slice(0, 1800);
    if (!rawText || rawText.length < 10) continue;
    const title = titleFrom(card, parsed.matched);
    const url = linkFrom(card, el);
    const key = [parsed.currency, Math.round(parsed.amount * 100), title, url].join("|");
    if (seen.has(key)) continue;
    seen.add(key);

    const contextBonus = card !== el ? 0.15 : 0;
    const titleBonus = title ? 0.2 : 0;
    const linkBonus = url !== location.href ? 0.15 : 0;
    candidates.push({
      provider,
      providerId,
      category,
      title,
      price: parsed.amount,
      currency: parsed.currency,
      priceBasis: detectBasisLocal(rawText),
      rating: ratingFrom(rawText),
      url,
      sourceUrl: location.href,
      rawText,
      confidence: Math.min(0.95, 0.35 + contextBonus + titleBonus + linkBonus)
    });
  }

  candidates.sort((a, b) => (b.confidence - a.confidence) || (a.price - b.price));
  return {
    pageTitle: document.title,
    pageUrl: location.href,
    candidateCount: candidates.length,
    candidates: candidates.slice(0, maxResults)
  };
}
