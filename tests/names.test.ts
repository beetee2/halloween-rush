import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { APPROVED_NAMES, approvedName, nameProblem } from '../src/core/names.mjs';
import { scoreboardName } from '../src/core/scoreboard';

describe('scoreboard names', () => {
  it('accepts one approved name in any case, keeping how it was typed', () => {
    for (const name of ['Hudson', 'hudson', 'EMMA', 'Brad', 'George', 'Susy', 'Mohammed', 'Xiomara', 'Jo', 'Mom', 'Grandpa', 'Abuela', 'Pumpkin', 'Frankenstein']) {
      expect(approvedName(name)).toBe(name);
    }
  });

  it('accepts accented spellings of listed names', () => {
    expect(approvedName('José')).toBe('José');
    expect(approvedName('Zoë')).toBe('Zoë');
    const accent = String.fromCodePoint(0x301); // typed as e + a combining accent
    expect(approvedName(`Jose${accent}`)).toBe('José');
  });

  it('rejects rude words, slang and insults, however they are spelled', () => {
    const rude = [
      'fuck', 'SHIT', 'Bitch', 'ass', 'asshole', 'damn', 'crap', 'poop', 'butt', 'penis', 'sexy', 'porn', 'weed', 'nazi', 'retard', 'stupid', 'idiot', 'loser', 'dumb', 'hell', 'suck', 'kill',
      'sh1t', 'f4ck', 'phuck', 'fuk', 'shiiit', 'b!tch', '$hit', 'a$$', 'fu ck', 'f.u.c.k', 'f_u_c_k',
      'fυck', // Greek upsilon
      'ѕhit', // Cyrillic s
      'ｆｕｃｋ', // full-width letters
    ];
    for (const w of rude) expect(approvedName(w), w).toBe('');
  });

  it('rejects real names that read as rude words, slang or slurs', () => {
    for (const w of ['Dick', 'Dickie', 'Fanny', 'Fannie', 'Gay', 'Gaylord', 'Gypsy', 'Johnson', 'Isis', 'Jihad', 'Adolph', 'Nazir', 'Kunta', 'Kush', 'Hung', 'Lolita', 'Pansy', 'Tequila', 'Jizelle', 'Analy', 'Christ']) {
      expect(approvedName(w), w).toBe('');
    }
  });

  it('rejects more than one word, numbers in place of letters, symbols and emoji', () => {
    const bad = ['Emma Rose', 'Mo Lester', 'Br4d', '2Brad', 'Brad-2', '69', 'Hudson!', "D'Andre", 'Mary-Kate', '\u{1F383}', 'Emma\u{1F383}', '', ' ', `H${String.fromCodePoint(0x336)}udson`];
    for (const w of bad) expect(nameProblem(w), w).toBe('name');
  });

  it('allows a number after the name, so two Brads can be Brad and Brad2', () => {
    for (const name of ['Brad2', 'Brad 2', 'Susy7', 'George2016', 'Emma10', 'Mom2', 'Pumpkin13', 'José1']) expect(approvedName(name), name).toBe(name);
  });

  it('rejects rude numbers and numbers that finish spelling a rude word', () => {
    const bad = [
      'Brad69', 'Brad690', 'Brad420', 'Emma666', 'Liam88', 'Liam1488', 'Brad8008', 'Brad7734', 'Brad12345',
      'Ana1', // anal
      'Bo08', // boob
      'Josh17', // shit
      'Lisa55', // ass
      'Kristi75', // tits
      'Don9', // dong
      'Heidi07', // idiot
      'Safa9', // fag
      'Ava455', // ass, in the digits alone
    ];
    for (const w of bad) expect(nameProblem(w), w).toBe('number');
  });

  it('checks the typed name after cleaning it', () => {
    expect(scoreboardName('  Hudson \n')).toBe('Hudson');
    expect(scoreboardName('Brad \t 2')).toBe('Brad 2');
    expect(scoreboardName('Hud son')).toBe('');
    expect(scoreboardName('')).toBe('');
  });

  it('keeps the list clean: single lowercase words that fit the name box', () => {
    expect(APPROVED_NAMES.size).toBeGreaterThan(9000);
    const odd = [...APPROVED_NAMES].filter((n) => !/^[a-z]+$/.test(n) || n.length < 2 || n.length > CONFIG.scoreboard.nameMaxChars);
    expect(odd).toEqual([]);
    // No listed name even contains these.
    const rude = /fuck|shit|cunt|dick|cock|porn|sex|slut|whore|nigg|fag|bitch|piss|rape|twat|wank|penis|vagina|boob|tits|nazi|hitler|poop|butt|crap|damn|suck|weed|dumb|stupid|idiot|retard|homo|queer|dyke|jizz|cum|kkk/;
    expect([...APPROVED_NAMES].filter((n) => rude.test(n))).toEqual([]);
  });
});
