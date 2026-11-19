// Notes left by people who were here before. Short, plain, tired.

export const NOTES = [
  { id: 'n01', order: 1, levels: ['level0'], title: 'Torn receipt, back side', text: `If you're reading this you got here the same way I did. You were somewhere normal and then you weren't.\n\nDon't run. There's nothing to run from yet. Running is how they hear you.` },
  { id: 'n02', order: 2, levels: ['level0'], title: 'Index card', text: `Day 3 (I think).\nI marked a wall with my pen. I walked a straight line for an hour and came back to the mark.\nThe mark was on the other wall.` },
  { id: 'n03', order: 3, levels: ['level0'], title: 'Notebook page', text: `The lights aren't the same everywhere. Some rooms are dead. I avoided them at first.\n\nI think the dead rooms are the way out. When the lights die, keep walking. Don't stop and don't turn back. There's a floor that isn't there.` },
  { id: 'n04', order: 4, levels: ['level0'], title: 'Sticky note', text: `The hum stops sometimes.\nWhen it does, stay still until it comes back.\nI don't know why. It just feels like the right thing to do.` },
  { id: 'n05', order: 5, levels: ['level0'], title: 'Folded paper', text: `Found a bottle of something that smells like almonds. Drank it. First time my head's been quiet since I got here.\n\nIf you find them, keep them. You'll want them later.` },
  { id: 'n06', order: 6, levels: ['level0'], title: 'Page from a planner', text: `Monday: walked.\nTuesday: walked.\nWednesday: heard someone. Couldn't find them.\nThursday: there is no Thursday.` },
  { id: 'n07', order: 1, levels: ['level1'], title: 'Clipboard sheet', text: `INVENTORY — B LEVEL\nwater: 6 (opened 2)\nbatteries: 4\nrope: yes\npeople: me\n\nThe stairwells go down. Everyone says don't go down. Everyone also isn't here anymore.` },
  { id: 'n08', order: 2, levels: ['level1'], title: 'Wet cardboard', text: `There's something that walks on all fours here. I heard it before I saw it. I never really saw it.\n\nWALK. Do not run. It finds the ones who run.` },
  { id: 'n09', order: 3, levels: ['level1'], title: 'Spray paint on a crate lid', text: `SOME CRATES HAVE STUFF\nMOST DON'T\nTAKE ONE THING LEAVE THE REST\nFOR THE NEXT ONE` },
  { id: 'n10', order: 4, levels: ['level1'], title: 'Ripped flyer', text: `PARTY TONIGHT! =)\nfollow the balloons\n\n(someone wrote underneath in pencil: don't.)` },
  { id: 'n11', order: 1, levels: ['level2'], title: 'Grease-stained note', text: `It's hot down here and the pipes talk. They knock back if you knock.\n\nI found a door at the end of a tunnel with red light under it. I could hear an alarm on the other side. I'm going through. If this note is still here, I didn't come back.` },
  { id: 'n12', order: 2, levels: ['level2'], title: 'Matchbook, inside cover', text: `turn left turn left turn left\nyou're back where you started\nturn right\nyou're back where you started` },
  { id: 'n13', order: 1, levels: ['levelRun'], title: 'Scrawl on the wall', text: `DON'T STOP` },
  { id: 'n14', order: 1, levels: ['level4'], title: 'Memo, company letterhead (no company name)', text: `REMINDER: Please do not open the windows.\nThe view is for display purposes only.\n\nThank you for your continued attendance.` },
  { id: 'n15', order: 2, levels: ['level4'], title: 'Post-it on a monitor', text: `It's so quiet here. The water cooler works. Nobody comes in.\n\nI could stay. I almost want to.\n\nOne of the windows by the far wall doesn't have glass. I can feel air coming through it. It smells like chlorine.` },
  { id: 'n16', order: 3, levels: ['level4'], title: 'Timesheet', text: `Hours worked: \nHours here: \nHours left: \n\nAll three boxes have been filled in and scribbled out so many times the paper is soft.` },
  { id: 'n17', order: 1, levels: ['level37'], title: 'Laminated card, poolside', text: `This is the nicest place I've found. The water's warm. The light comes from everywhere.\n\nI don't trust it. Nothing here wants anything. That's what scares me.` },
  { id: 'n18', order: 2, levels: ['level37'], title: 'Note in a plastic bag', text: `Somebody said there's a door down here. A plain wooden one. Like the one to your bedroom when you were a kid.\n\nThey said it goes home. They said "home" in a funny way.` },
  { id: 'n19', order: 1, levels: ['levelFun'], title: 'Party napkin', text: `They're nice. They keep asking me to stay. They keep smiling.\n\nThey haven't blinked once.\n\nFind the room where the lights are off.` },
  { id: 'n20', order: 9, title: 'Back of a photograph', text: `The photo is of a hallway. Yellow walls. Someone in the far distance, too blurry to make out.\n\nOn the back: "this was the first day. I didn't notice them until I got it developed."` },
  { id: 'n21', order: 9, title: 'Child\'s handwriting', text: `i heard my mom calling for me from the next room. i went to the next room and she was calling from the next one.\n\ni stopped going.` },
  { id: 'n22', order: 9, title: 'Business card', text: `[the front is blank]\n\nBack: If you hear someone asking for help, they are not someone. Keep walking.` },
];

export const CODEX = {
  levels: {
    showroom: { name: 'The Showroom', text: 'A furniture store after closing. Display rooms nobody lives in. Stairs down to the basement, and a doorway in the basement wall that was not there yesterday.' },
    house: { name: 'Home', text: 'A house at 3 AM. The fridge hums. The clock ticks, mostly on time. You were thirsty.' },
    level0: { name: 'Level 0 — "The Lobby"', text: 'Mono-yellow wallpaper, damp carpet, fluorescent lights that never turn off. Endless and almost entirely empty. The way forward is reportedly through places where the lights have failed.' },
    level1: { name: 'Level 1 — "Habitable Zone"', text: 'A vast concrete structure like a parking garage that never ends. Cold, damp, lit in patches. Supply crates appear without explanation. Stairwells lead down.' },
    level2: { name: 'Level 2 — "Pipe Dreams"', text: 'Narrow maintenance tunnels, hot and close. Pipes clank in the distance. Some say a red-lit door can be found at the end of a long tunnel.' },
    levelRun: { name: 'Level ! — "Run For Your Life"', text: 'A long corridor, red emergency light, an alarm. Something is behind you. Do not stop.' },
    level4: { name: 'Level 4 — "Abandoned Office"', text: 'An office the morning after everyone left. The water coolers still hum. The windows look out on white. Eerily calm.' },
    level37: { name: 'Level 37 — "The Poolrooms"', text: 'White tile and still turquoise water, lit by daylight from nowhere. Nothing lives here. That is the problem.' },
    levelFun: { name: 'Level Fun =)', text: 'A party for someone. Balloons, streamers, music from a tape that is going bad. The guests are very happy to see you. Do not let them get close.' },
  },
  entities: {
    item_almond: { name: 'Almond Water', text: 'Bottled water with a faint, sweet almond taste. Quiets the mind. Precious.' },
    faceling: { name: 'Facelings', text: 'Figures with no faces, standing very still at a distance. They usually just stand there. Usually.' },
    smiler: { name: 'Smilers', text: 'A grin in the dark. Look away and it may be gone. Walk into the dark toward it and it will not be.' },
    hound: { name: 'Hounds', text: 'Heard before seen: breathing, padding, a low growl. Drawn to the sound of running. Crouch and keep still.' },
    partygoer: { name: 'Partygoers', text: 'Yellow figures with painted grins. They want you to stay for the party.' },
    skinstealer: { name: '???', text: 'A voice asking for help from somewhere you can never quite reach. You never found who it was.' },
    chaser: { name: 'The thing in Level !', text: 'You never saw it clearly. You only heard how close it was.' },
  },
  endings: {
    escape: { name: 'Home', text: 'You found the door and you went home. It was almost exactly how you left it.' },
    wander: { name: 'Wanderer', text: 'You stopped looking for the exit. The halls don\'t mind.' },
    lost: { name: 'Lost Tape', text: 'The recording ends here.' },
  },
};
