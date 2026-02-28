const groups = [
  {
    id: 1,
    name: "Ownership",
    description: "These 3 members own the faction and have final decision on all aspect of the faction. All three members are available to assist, train, and answer questions.",
    focus: "Our goal is to ensure you understand what you are doing no matter the team you are on.",
    members: 3,
    color: "#004cff"
  },
  {
    id: 2,
    name: "Leadership",
    description: "These members help to determine the path that the faction is on. Leadership is available to help answer questions as they arise.",
    focus: "Assisting ownership in day-to-day operations and to ensure members of each team have what they need to succeed.",
    members: 2,
    color: "#cf3ee5"
  },
  {
    id: 3,
    name: "Strategy",
    description: "his team is made up of members who are greater than level 15 and have shown the ability to help leadership plan and execute war plans. This team is a leadership invite only.",
    focus: "To ensure members of Strength and Growth understand the war strategy, war rules, and are prepared to war.",
    members: 4,
    color: "#ff0000"
  },
  {
    id: 4,
    name: "Strength",
    description: "This team is made up of members at level 15 or greater. Their focus is on stats (and playing the rest of the game 😁 ).",
    focus: "Making money to purchase items for stats growth and to be able to rent a Private Island with an airstrip.",
    members: 17,
    color: "#e67e22"
  },
  {
    id: 5,
    name: "Growth",
    description: "This team is made up of members under level 15.",
    focus: "Making their way to level 15 through attacks (leaving their opponent), crimes, and training in the gym.",
    members: 3,
    color: "#2ecc71"
  }
];

// Addition: Calculate total members by summing the 'members' property of each group
const totalMembers = groups.reduce((sum, group) => sum + group.members, 0);

const factionData = {
  faction: {
    name: "S.S.G - Strategy | Strength | Growth",
    memberCount: totalMembers, // This will now be 29
  },
  groups: groups
};

module.exports = factionData;