# ShadeSide Farms — Domain Knowledge

Background on how the farm operates. Consult this when designing features to avoid naive assumptions about the business, the animals, or the land.

---

## The Farm

Located in Pakistan. Total land is 12–13 acres. Current operational breakdown:
- ~4 acres actively farmed
- ~1 acre used for infrastructure
- Remaining acres held by a tenant farmer, to be reclaimed progressively over coming years

The overarching goal is to become the most successful regenerative farm in Pakistan, with specific focus on soil rehabilitation, biodiversity restoration, and productive output — these three are not in tension, they are meant to reinforce each other.

---

## What Success Looks Like

The farm must:
1. Sustain itself financially (cover all operating costs)
2. Pay all household bills
3. Generate enough surplus to fund travel for the owner and his wife
4. Continually improve biodiversity and soil health

Profitability and ecological health are both primary metrics — neither is subordinate to the other. When designing financial tracking or reporting features, keep both in view.

---

## Commercial Core — Goat Fattening

This is the primary income operation.

**The cycle:** Buy young animals at approximately 20–22 kg live weight. Fatten over 3–5 months to a target of 40–50 kg. Sell at market. Target ADG (average daily gain) is roughly 100–150g/day.

**Breed:** Maki Cheeni, a local breed related to Beetal. Mixed heritage is common in this region.

**Eid animals:** A second category is planned — animals held longer and sold specifically for Eid ul Adha at a premium. This will eventually run alongside the regular fattening cycle but is not yet active.

**Current herd:** The existing goats (~10) are not part of the formal fattening system. They have been used to test and refine concentrate recipes, and they are allowed to forage in addition to being fed. They are learning and development animals.

---

## Feed System

All animals are fed a mixed total ration consisting of three components, chopped and fed together:

1. **Concentrate** — made on-farm by purchasing raw ingredients and mixing. Recipes are working but will always require seasonal fine-tuning due to ingredient availability. The feed modeller and ration plans in the dashboard exist specifically to manage this.

2. **Hay** — purchased or stored.

3. **Green fodder** — grown on-farm. Current summer crops include: sorghum, maize, sesbania, cowpeas, cluster beans, millet.

Fattening animals (future) will be on a controlled ration only — no foraging. Current animals forage in addition to their ration, which means their feed data is less precise and should not be used to calibrate the fattening model directly.

---

## Land and Crops

4 acres actively farmed, primarily for fodder production to support the goat operation.

Future plans include high-value vegetables and herbs, but these are on hold due to water quality constraints (see below).

Longer-term experiments planned: black soldier fly (BSF) larvae production, turkey rearing.

---

## Water

**Primary tube well:** EC ~2,800 µS/cm — very high salinity. Used for field irrigation. Limits what can be grown; rules out most vegetables and salt-sensitive crops. Fodder crops (sorghum, sesbania, cowpeas, etc.) were partly chosen for their salt tolerance.

**Secondary injection pump:** EC ~1,600 µS/cm — lower salinity, better quality. Used for farm infrastructure and animal water needs, not field irrigation.

**Planned:** A new well is being explored following a survey. If drilled successfully, it could open up vegetable and herb production. Any land or crop planning features should account for water source as a constraint, not a given.

---

## Current Animals (Non-Commercial)

These animals are present for learning, biodiversity, and farm ecosystem purposes:
- ~10 goats (recipe testing, foraging)
- 4 sheep
- 3 donkeys
- 2 geese, 2 ducks, 2 ducklings
- 5 chickens, ~10 chicks
- 3 dogs
- ~8 rabbits

None of these are currently part of a formal production cycle. Do not assume that feed, weight, or health data from these animals is representative of the fattening operation.

---

## Regenerative Focus

Soil health and biodiversity are tracked alongside financials — they are not afterthoughts. The farm uses nitrogen-fixing crops (sesbania, cowpeas, cluster beans), plans to use BSF frass as fertiliser, and manages soil tests and amendment applications in the dashboard. When designing any land, crop, or input feature, consider how it supports or reports on soil health, not just yield or cost.
