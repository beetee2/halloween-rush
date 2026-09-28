// Which names may go on a scoreboard. This is an allowlist, not a bad-word filter: a name must
// be exactly one word from the approved lists, so no rude word, slang or trick spelling can get
// through, however it's typed. A number may follow it ("Brad2") so people with the same name
// can tell themselves apart, but never one that is rude itself or finishes spelling a rude word
// ("Ana1", "Bo08"). Plain JavaScript because the game and the scores server
// (scripts/scores-api.mjs) share it.
import { NAMES } from './nameList.mjs';

/** So grown-ups can play too. */
const FAMILY = `
mom mommy momma mama mum ma mother dad daddy dada papa pa pop pops father
grandma grandpa granny gran grandad granddad grandmom grandmother grandfather gramma grampa gram
gramps grammy nana nanna nonna nonno abuela abuelo abuelita abuelito mimi meemaw memaw mamaw
pawpaw papaw peepaw gigi oma opa lola lolo bubbe zayde aunt auntie aunty uncle tia tio
brother sister sis cousin baby bubba
`;

/** For anyone who'd rather not use their own name, or whose name isn't listed. */
const SPOOKY = `
pumpkin ghost ghoul goblin witch wizard vampire zombie mummy skeleton spider bat monster
werewolf scarecrow phantom spooky boo dracula frankenstein candycorn jackolantern lantern cauldron
potion broomstick cobweb haunted specter spectre banshee gremlin imp ogre yeti bigfoot boogeyman
trickster treat moonlight blackcat nightowl howl
`;

/** Vague names for anyone who'd rather not give theirs: "Player", "Player 123", "Hero7". */
const GENERIC = `
player gamer guest someone somebody anyone anybody nobody mystery secret unknown anonymous incognito
hero superhero champ champion winner legend star superstar rookie newbie pro ace captain chief boss
king queen prince princess knight ninja pirate robot alien astronaut explorer ranger scout agent
detective buddy pal friend kid kiddo sport rockstar lucky happy sunny smiley silly sparky
tiger lion bear wolf fox owl cat kitty kitten puppy bunny panda koala penguin shark dino dinosaur
dragon unicorn phoenix rocket comet meteor thunder lightning storm shadow midnight
cookie cupcake lollipop gumdrop jellybean marshmallow caramel
`;

const words = (s) => s.split(/\s+/).filter(Boolean);

/** Every approved name, lowercase a-z. */
export const APPROVED_NAMES = new Set([...words(NAMES), ...words(FAMILY), ...words(SPOOKY), ...words(GENERIC)]);

/**
 * A name, then maybe a number: "Brad", "Brad2", "Brad 2019". Letters are a-z plus accented
 * Latin letters such as é or ñ.
 */
const SHAPE = /^([A-Za-zÀ-ÖØ-öø-ÿ]+)(?: ?([0-9]+))?$/;

/** Longer numbers can spell words, e.g. upside down on a calculator. */
const MAX_DIGITS = 4;

/** Numbers that are rude or hateful on their own, also inside a longer number. */
const RUDE_NUMBERS = /69|88|187|311|420|666|1312|7734|8008/;

/** The letters digits stand in for ("sh17"): 1 can be i or l, 6 can be b or g. */
const LOOKALIKES = { a: '4', b: '68', e: '3', g: '69', i: '1', l: '1', o: '0', s: '5', t: '7', z: '2' };

/** Rude words, slurs and slang whose ends digits could spell (only LOOKALIKES letters can). */
const RUDE_WORDS = words(`
anal arse ass asses balls bitches bong boob boobie boobies boobs booze butt butts coke dildo
dildos dong dope douche dyke fag fags fart farts hoe hoes homo idiot jizz kike lesbo molest nazi
nazis negro nigga niggas nipple nipples nude nudes paki pedo penis piss porno pube pubes puss
rape rapist shit shite shits slag slut sluts smut tit tits titties twat whore whores
`);

/** Lowercase with accents removed, as the lists are written. */
const plain = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** A rude word spelled across the end of `name` and into `digits`, or in the digits alone. */
function spellsRudeWord(name, digits) {
  const s = name + digits;
  return RUDE_WORDS.some((word) => {
    // Only placements that reach the digits count: the name alone is approved.
    for (let i = Math.max(0, name.length - word.length + 1); i + word.length <= s.length; i++) {
      if ([...word].every((c, k) => s[i + k] === c || LOOKALIKES[c]?.includes(s[i + k]))) return true;
    }
    return false;
  });
}

/**
 * Why `name` (already cleaned) can't go on a scoreboard: 'name' if the word isn't approved,
 * 'number' if the number after it isn't allowed, or '' if it's fine.
 */
export function nameProblem(name) {
  const m = SHAPE.exec(String(name).normalize('NFC'));
  if (!m || !APPROVED_NAMES.has(plain(m[1]))) return 'name';
  const digits = m[2] ?? '';
  if (digits.length > MAX_DIGITS || RUDE_NUMBERS.test(digits) || spellsRudeWord(plain(m[1]), digits)) return 'number';
  return '';
}

/**
 * `name` (already cleaned) if it may go on a scoreboard, otherwise ''. Case and accents don't
 * matter, so "JOSÉ" matches "jose"; the name keeps the spelling that was typed.
 */
export function approvedName(name) {
  return nameProblem(name) ? '' : String(name).normalize('NFC');
}

/** What the boards call a run nobody named. */
export const UNNAMED = 'Player';

/**
 * The name to store for a run: `name` (already cleaned) if approved, else ''. Plain "Player" is
 * stored as '' too, as if the box were left blank: each device keeps its own "Player" career
 * instead of everyone who typed it sharing one. "Player2" is a name like any other.
 */
export function runName(name) {
  const ok = approvedName(name);
  return plain(ok) === plain(UNNAMED) ? '' : ok;
}
