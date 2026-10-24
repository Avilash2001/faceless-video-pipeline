import { describe, expect, it } from 'vitest';
import type { StrategyRules } from '../src/types.js';
import { startTestDaemon } from './support/testDaemon.js';

const SUNDAY_10AM = new Date('2026-10-25T10:00');

/** The strategy as written by hand, before any evolve. */
const V2: StrategyRules = {
  version: 2,
  updatedAt: '2026-10-24T00:00:00.000Z',
  explorationRate: 0.25,
  targetDurationSeconds: { min: 30, max: 50 },
  nicheWeights: {
    reddit_revenge: 0.14,
    reddit_aita: 0.1,
    reddit_entitled: 0.1,
    reddit_workplace: 0.06,
    reddit_updates: 0.06,
    true_heists_cons: 0.12,
    true_vanished_unsolved: 0.1,
    true_survival: 0.08,
    true_business_blunders: 0.06,
    fiction_drama: 0.08,
    fiction_confessions: 0.1,
  },
  hookArchetypeWeights: {
    cold_open_climax: 0.3,
    shocking_confession: 0.2,
    impossible_question: 0.2,
    stakes_reveal: 0.15,
    twist_tease: 0.15,
  },
  voicePool: {
    male: ['en-US-AndrewNeural', 'en-US-BrianNeural'],
    female: ['en-US-AvaNeural', 'en-US-EmmaNeural'],
  },
  voiceSpeedRate: '+10%',
  doRules: ['Open on the most surprising concrete moment of the story in 10 words or fewer.'],
  dontRules: ["Never open with a greeting, 'Did you know', or 'Today we'."],
};

/** V2 with a weight left over for a Genre the Genre list no longer has. */
const WITH_RETIRED_GENRE = { ...V2, nicheWeights: { ...V2.nicheWeights, reddit_nosleep: 0.05 } };

const LAST_SUNDAY_4AM = new Date('2026-10-18T04:00');
const SUNDAY_4AM = new Date('2026-10-25T04:00');

/** The first evolve: toward heists and cold opens, away from revenge and twist teases. */
const V3: StrategyRules = {
  ...V2,
  version: 3,
  updatedAt: LAST_SUNDAY_4AM.toISOString(),
  nicheWeights: { ...V2.nicheWeights, reddit_revenge: 0.1, true_heists_cons: 0.16 },
  hookArchetypeWeights: { ...V2.hookArchetypeWeights, cold_open_climax: 0.35, twist_tease: 0.1 },
};

/** The second evolve: a little toward survival, away from drama. */
const V4: StrategyRules = {
  ...V3,
  version: 4,
  updatedAt: SUNDAY_4AM.toISOString(),
  nicheWeights: { ...V3.nicheWeights, true_survival: 0.105, fiction_drama: 0.055 },
};

describe('Strategy page', () => {
  it('is linked from the front page, and links back to it', async () => {
    const { request } = startTestDaemon({ now: SUNDAY_10AM, strategy: V2 });

    expect(await (await request('/')).text()).toMatch(/<a href="\/strategy">Strategy<\/a>/);
    expect(await (await request('/strategy')).text()).toMatch(/<a href="\/">Dashboard<\/a>/);
  });

  it('shows the current strategy version and its Genre weights', async () => {
    const { pageText } = startTestDaemon({ now: SUNDAY_10AM, strategy: V2 });

    const page = await pageText('/strategy');
    expect(page).toContain('Version 2 Exploration rate 25% Target length 30–50 s');
    expect(page).toContain(
      'Genre weights reddit_revenge 14% reddit_aita 10% reddit_entitled 10% reddit_workplace 6% reddit_updates 6% ' +
        'true_heists_cons 12% true_vanished_unsolved 10% true_survival 8% true_business_blunders 6% ' +
        'fiction_drama 8% fiction_confessions 10%'
    );
  });

  it('says so when no evolve has changed the strategy yet', async () => {
    const { pageText } = startTestDaemon({ now: SUNDAY_10AM, strategy: V2 });

    expect(await pageText('/strategy')).toContain('Evolves No evolve has changed the strategy yet.');
  });

  it('lists each evolve newest first, with its critic summary and the change in each weight from the version before', async () => {
    const { pageText, recordEvolve } = startTestDaemon({ now: SUNDAY_10AM, strategy: V2 });
    recordEvolve(V3, 'Heists held viewers longest; revenge stories lost them in the first seconds.', LAST_SUNDAY_4AM);
    recordEvolve(V4, 'Survival stories are catching up; drama keeps underperforming.', SUNDAY_4AM);

    const page = await pageText('/strategy');
    const evolves = page.slice(page.indexOf('Evolves'));
    expect(evolves).toContain(
      'Version 4 Evolved from version 3 on Sun 25 Oct 04:00 ' +
        'Survival stories are catching up; drama keeps underperforming. ' +
        'Genre weights reddit_revenge 10% no change reddit_aita 10% no change reddit_entitled 10% no change ' +
        'reddit_workplace 6% no change reddit_updates 6% no change true_heists_cons 16% no change ' +
        'true_vanished_unsolved 10% no change true_survival 8% → 10.5% +2.5 pts true_business_blunders 6% no change ' +
        'fiction_drama 8% → 5.5% −2.5 pts fiction_confessions 10% no change ' +
        'Hook weights cold_open_climax 35% no change shocking_confession 20% no change ' +
        'impossible_question 20% no change stakes_reveal 15% no change twist_tease 10% no change'
    );
    expect(evolves).toContain(
      'Version 3 Evolved from version 2 on Sun 18 Oct 04:00 ' +
        'Heists held viewers longest; revenge stories lost them in the first seconds. ' +
        'Genre weights reddit_revenge 14% → 10% −4 pts reddit_aita 10% no change'
    );
    expect(evolves).toContain(
      'Hook weights cold_open_climax 30% → 35% +5 pts shocking_confession 20% no change ' +
        'impossible_question 20% no change stakes_reveal 15% no change twist_tease 15% → 10% −5 pts'
    );
    expect(evolves.indexOf('Version 4')).toBeLessThan(evolves.indexOf('Version 3'));
    expect(page).not.toContain('No evolve has changed the strategy yet.');
  });

  it("says the strategy file can't be read when it is missing, and still lists the evolves", async () => {
    const { pageText } = startTestDaemon({ now: SUNDAY_10AM });

    const page = await pageText('/strategy');
    expect(page).toContain("Current strategy The strategy file data/strategy_rules.json can't be read: ENOENT");
    expect(page).toContain('Evolves No evolve has changed the strategy yet.');
  });

  it('shows a change too small for whole tenths of a percent, rather than calling it no change', async () => {
    const { pageText, recordEvolve } = startTestDaemon({ now: SUNDAY_10AM, strategy: V2 });
    const nicheWeights = { ...V2.nicheWeights, true_survival: 0.0812, fiction_drama: 0.0788 };
    recordEvolve({ ...V2, version: 3, nicheWeights }, 'Survival edges ahead.', SUNDAY_4AM);

    const page = await pageText('/strategy');
    expect(page).toContain('true_survival 8% → 8.12% +0.12 pts');
    expect(page).toContain('fiction_drama 8% → 7.88% −0.12 pts');
  });

  it('labels a weighted Genre that is no longer in the Genre list as retired', async () => {
    const { pageText } = startTestDaemon({ now: SUNDAY_10AM, strategy: WITH_RETIRED_GENRE });

    const page = await pageText('/strategy');
    expect(page).toContain('fiction_confessions 10% reddit_nosleep retired 5%');
    expect(page.match(/retired/g)).toHaveLength(1);
  });

  it('labels a retired Genre in the evolves too', async () => {
    const nicheWeights = { ...WITH_RETIRED_GENRE.nicheWeights, reddit_nosleep: 0.04, true_survival: 0.09 };
    const { pageText, recordEvolve } = startTestDaemon({ now: SUNDAY_10AM, strategy: WITH_RETIRED_GENRE });
    recordEvolve({ ...WITH_RETIRED_GENRE, version: 3, nicheWeights }, 'Fewer ghost stories.', SUNDAY_4AM);

    const page = await pageText('/strategy');
    expect(page.slice(page.indexOf('Evolves'))).toContain('reddit_nosleep retired 5% → 4% −1 pt Hook weights');
  });

  it('shows its hook weights, its do and don\'t rules, and its voice pool and voice speed', async () => {
    const { pageText } = startTestDaemon({ now: SUNDAY_10AM, strategy: V2 });

    const page = await pageText('/strategy');
    expect(page).toContain(
      'Hook weights cold_open_climax 30% shocking_confession 20% impossible_question 20% stakes_reveal 15% twist_tease 15%'
    );
    expect(page).toContain('Do Open on the most surprising concrete moment of the story in 10 words or fewer.');
    expect(page).toContain("Don't Never open with a greeting, 'Did you know', or 'Today we'.");
    expect(page).toContain(
      'Voices Male en-US-AndrewNeural, en-US-BrianNeural Female en-US-AvaNeural, en-US-EmmaNeural Speed +10%'
    );
  });
});
