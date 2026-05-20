const ranks = [
  { orders: 20, rank: "The Untouchable" },
  { orders: 17, rank: "Godfather" },
  { orders: 15, rank: "Overlord" },
  { orders: 13, rank: "Emperor" },
  { orders: 11, rank: "Warlord" },
  { orders: 9, rank: "Sovereign" },
  { orders: 7, rank: "Kingpin" },
  { orders: 5, rank: "Royal" },
  { orders: 3, rank: "Noble" },
  { orders: 1, rank: "Member" }
];

export const getLoyaltyRank = (deliveredOrderCount) =>
  ranks.find((item) => deliveredOrderCount >= item.orders)?.rank || "Member";
