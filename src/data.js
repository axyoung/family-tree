// ---------------------------------------------------------------------------
// SAMPLE FAMILY DATA
// ---------------------------------------------------------------------------
// Notes on the fields:
//
// - `gender`: REQUIRED by family-chart, must be "M" or "F". This is used
//   ONLY for the library's internal layout/coloring — it is NOT shown as-is
//   on the card. Pick whichever is closer, or default to "M"/"F" arbitrarily
//   for people who don't identify as either.
//
// - `gender_identity`: what actually gets displayed on the card. Free text,
//   e.g. "Non-binary", "Woman", "Man", "Trans man", whatever the person
//   wants shown.
//
// - `parents_bio` / `parents_adoptive`: custom fields (NOT the library's
//   built-in `rels.parents`). The toggle in main.js picks one of these and
//   maps it into `rels.parents` right before rendering, so the same person
//   node can show either lineage without duplicating the person.
//
// - `photos`: array of { url, caption } objects. Rendered in the scrollable
//   gallery modal when someone clicks "View Photos" on a card.
// ---------------------------------------------------------------------------

export const familyData = [
  {
    id: "grandma_rose",
    data: {
      "first name": "Rose",
      "last name": "Nguyen",
      birthday: "1948",
      gender: "F",
      gender_identity: "Woman",
      description: "Grew up on a rice farm outside Da Lat before moving to the coast in her twenties.",
      photos: [
        { url: "https://placehold.co/500x400?text=Rose+1965", caption: "Rose, age 17" },
        { url: "https://placehold.co/500x400?text=Rose+Wedding", caption: "Wedding day, 1970" },
        { url: "https://placehold.co/500x400?text=Rose+Garden", caption: "In her garden, 1990s" }
      ]
    },
    rels: { spouses: ["grandpa_hue"], children: ["mom_bio"] }
  },
  {
    id: "grandpa_hue",
    data: {
      "first name": "Hue",
      "last name": "Nguyen",
      birthday: "1945",
      gender: "M",
      gender_identity: "Man",
      description: "Fisherman for most of his life, later ran a small hardware shop.",
      photos: [
        { url: "https://placehold.co/500x400?text=Hue+Boat", caption: "On his boat, 1972" }
      ]
    },
    rels: { spouses: ["grandma_rose"], children: ["mom_bio"] }
  },
  {
    id: "mom_bio",
    data: {
      "first name": "Lin",
      "last name": "Nguyen",
      birthday: "1972",
      gender: "F",
      gender_identity: "Woman",
      description: "Lin is Alex's biological mother.",
      photos: [
        { url: "https://placehold.co/500x400?text=Lin+1990", caption: "Lin, 1990" }
      ]
    },
    rels: { parents: ["grandma_rose", "grandpa_hue"], children: ["alex"] }
  },
  {
    id: "mom_adoptive",
    data: {
      "first name": "Carol",
      "last name": "Whitfield",
      birthday: "1965",
      gender: "F",
      gender_identity: "Woman",
      description: "Carol adopted Alex in 1998 and raised them.",
      photos: [
        { url: "https://placehold.co/500x400?text=Carol+1998", caption: "The adoption day, 1998" },
        { url: "https://placehold.co/500x400?text=Carol+Alex", caption: "Carol and Alex, 2005" }
      ]
    },
    rels: { children: ["alex"] }
  },
  {
    id: "alex",
    data: {
      "first name": "Alex",
      "last name": "Whitfield",
      birthday: "1998",
      gender: "M", // used only for layout; see gender_identity below
      gender_identity: "Non-binary",
      description: "Raised by Carol from age 0. Reconnected with biological mother Lin in 2020.",
      // Custom fields the toggle reads from — NOT family-chart's built-in `rels.parents`
      parents_bio: ["mom_bio"],
      parents_adoptive: ["mom_adoptive"],
      photos: [
        { url: "https://placehold.co/500x400?text=Alex+2000", caption: "Age 2" },
        { url: "https://placehold.co/500x400?text=Alex+2010", caption: "Age 12" },
        { url: "https://placehold.co/500x400?text=Alex+2020", caption: "Reunion with Lin, 2020" },
        { url: "https://placehold.co/500x400?text=Alex+2024", caption: "Graduation, 2024" }
      ]
    },
    rels: { spouses: [], children: [] }
    // rels.parents is intentionally left OUT here — main.js fills it in
    // dynamically from parents_bio/parents_adoptive depending on toggle state
  }
];
