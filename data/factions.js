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

const description = [
"Welcome to S.S.G, where strategy, strength, and growth define everything we do.",
"We're more than just a faction we're a team built on trust, teamwork, and the drive to succeed together.",
"Strategy: Every move we make is calculated.",
"Strength: We train hard, fight smart, and back each other up In every war.",
"Growth: Whether you're a seasoned fighter or just starting out, we'll help you level up fast with guidance, faction parks, group activities, competition, and team building exercises.",
"Travel perks and team missions keep our members active and rewarded.",
"A safe and fun environment to play, grow. and dominate the city together. We also have a Day Care should you so need it.",

"What we need from you:",
"Daily activity",
"Join OC (90% payout)",
"Join In with war and chaining",
"Join our S.S.G Discord and Torn Stats",
"Chat as much as you can and be a team player",
"Most Importantly, have fun!",
"If you're looking for a home that values teamwork, friendship, progress, and power then S.S.G Is where you belong.",
"Join us and grow stronger every day."];

// 1. Remove empty strings so the spacing isn't messy
const cleanedDescription = description.filter(line => line.trim() !== "");

const factionData = {
  faction: {
    name: "S.S.G - Strategy | Strength | Growth",
    description: cleanedDescription,
    memberCount: totalMembers, // This will now be 29
  },
  groups: groups
};

module.exports = factionData;