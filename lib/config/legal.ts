// Who runs LOOTBOX, for the Official Rules (/terms). Fill these in, and have a lawyer read /terms,
// before the page is linked anywhere. Until all four are set, the page shows each missing one as a
// gold [placeholder] and asks search engines not to index it.
export const LEGAL = {
  operator: "Devin Philips", // the legal name of whoever runs LOOTBOX: a company or a person's full name
  contactEmail: "support@getlootbox.fun", // where winners and holders can reach a person (getlootbox.fun forwards mail)
  governingLaw: "the State of Delaware",
  effective: "November 9, 2026", // when this version takes effect
};

export const legalReady = () => Object.values(LEGAL).every((v) => v.trim().length > 0);
