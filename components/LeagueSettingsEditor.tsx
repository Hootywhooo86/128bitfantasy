import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Card, CardHead, Chips } from '@/components/ui';
import { colors, fonts, themedStyles } from '@/lib/theme';
import { CATEGORIES } from '@/src/leagues/categories';
import { STAT_LABELS, type HostedSport } from '@/src/leagues/scoring';
import { PICK_CLOCKS, PLAYOFF_CHOICES, SLOT_CHOICES, settingsSummary } from '@/src/leagues/settings';
import { FORMAT_LABELS, FORMAT_NOTES, isH2H, usesCategories, type LeagueFormat, type LeagueSettings } from '@/src/leagues/types';

/**
 * Every league setting on one screen. `locked` = the draft has happened, so
 * the league's shape (format, lineup, bench, categories, weeks, draft) is
 * shown but can't change; everything else still can.
 */
export function LeagueSettingsEditor({
  sport,
  value,
  onChange,
  teams,
  onTeams,
  locked = false,
  readOnly = false,
}: {
  sport: HostedSport;
  value: LeagueSettings;
  onChange: (s: LeagueSettings) => void;
  teams: number;
  onTeams?: (n: number) => void;
  locked?: boolean;
  readOnly?: boolean;
}) {
  const s = value;
  const set = (patch: Partial<LeagueSettings>) => onChange({ ...s, ...patch });
  const shape = !locked && !readOnly;
  const any = !readOnly;
  const h2h = isH2H(s.format);
  const rosterSpots = Object.values(s.slots).reduce((a, b) => a + b, 0) + s.bench;

  return (
    <>
      <Card>
        <CardHead title="FORMAT" note={locked ? 'set at the draft' : undefined} />
        {shape ? (
          <Chips
            items={(Object.keys(FORMAT_LABELS) as LeagueFormat[]).map((f) => ({ id: f, label: FORMAT_LABELS[f].toUpperCase() }))}
            value={s.format}
            onChange={(f) => set({ format: f })}
          />
        ) : (
          <Text style={st.val}>{FORMAT_LABELS[s.format]}</Text>
        )}
        <Text style={st.note}>{FORMAT_NOTES[s.format]}</Text>
        {onTeams ? <Stepper label="TEAMS" value={teams} min={2} max={20} onChange={shape ? onTeams : undefined} /> : null}
      </Card>

      <Card>
        <CardHead title="ROSTER" note={settingsSummary(sport, s)} />
        {SLOT_CHOICES[sport].map((c) => (
          <Stepper
            key={c.slot}
            label={c.slot}
            hint={c.note}
            value={s.slots[c.slot] ?? 0}
            min={0}
            max={c.max}
            onChange={shape ? (n) => set({ slots: { ...s.slots, [c.slot]: n } }) : undefined}
          />
        ))}
        <Stepper label="BENCH" value={s.bench} min={0} max={15} onChange={shape ? (n) => set({ bench: n }) : undefined} />
        <Stepper label="IR" hint="Extra spots for injured players" value={s.ir} min={0} max={5} onChange={any ? (n) => set({ ir: n }) : undefined} />
      </Card>

      {usesCategories(s.format) ? (
        <Card>
          <CardHead title="CATEGORIES" note={`${s.categories.length} picked`} />
          <View style={st.wrap}>
            {CATEGORIES[sport].map((c) => {
              const on = s.categories.includes(c.key);
              return (
                <Pressable
                  key={c.key}
                  disabled={!shape}
                  style={[st.cat, on && st.catOn]}
                  onPress={() => set({ categories: on ? s.categories.filter((k) => k !== c.key) : [...s.categories, c.key] })}
                >
                  <Text style={[st.catT, on && st.catTOn]}>{c.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={st.note}>GAA, GA, INT and fumbles count lower as better.</Text>
        </Card>
      ) : null}

      {s.format === 'h2h_points' || s.format === 'points' ? (
        <Card>
          <CardHead title="POINTS PER STAT" />
          {sport === 'nfl' && any ? (
            <Chips
              items={[
                { id: '1', label: 'FULL PPR' },
                { id: '0.5', label: 'HALF PPR' },
                { id: '0', label: 'STANDARD' },
              ]}
              value={String(s.scoring.rec ?? 0) as '1' | '0.5' | '0'}
              onChange={(v) => set({ scoring: { ...s.scoring, rec: Number(v) } })}
            />
          ) : null}
          {Object.entries(s.scoring).map(([k, v]) => (
            <View key={k} style={st.srow}>
              <Text style={st.slabel}>{STAT_LABELS[k] ?? k.replace(/_/g, ' ')}</Text>
              <NumberBox value={v} editable={any} onChange={(n) => set({ scoring: { ...s.scoring, [k]: n } })} />
            </View>
          ))}
        </Card>
      ) : null}

      <Card>
        <CardHead title="SEASON & DRAFT" />
        <Stepper label="REGULAR SEASON WEEKS" value={s.weeks} min={1} max={26} onChange={shape ? (n) => set({ weeks: n }) : undefined} />
        {h2h ? (
          <>
            <Text style={st.lbl}>PLAYOFF TEAMS</Text>
            {any ? (
              <Chips
                items={PLAYOFF_CHOICES.filter((n) => n <= teams).map((n) => ({ id: String(n), label: n ? String(n) : 'NONE' }))}
                value={String(s.playoffTeams)}
                onChange={(v) => set({ playoffTeams: Number(v) })}
              />
            ) : (
              <Text style={st.val}>{s.playoffTeams || 'None'}</Text>
            )}
          </>
        ) : null}
        <Text style={st.lbl}>DRAFT TYPE</Text>
        {shape ? (
          <Chips
            items={[
              { id: 'snake', label: 'SNAKE' },
              { id: 'linear', label: 'SAME EVERY ROUND' },
              { id: 'auction', label: 'AUCTION' },
            ]}
            value={s.draftType}
            onChange={(v) => set({ draftType: v })}
          />
        ) : (
          <Text style={st.val}>{DRAFT_LABEL[s.draftType]}</Text>
        )}
        <Text style={st.note}>
          {s.draftType === 'auction'
            ? 'Teams take turns putting players up; everyone bids from a budget. Every bid restarts the clock.'
            : s.draftType === 'snake'
              ? 'Order reverses every round. Picks can be traded.'
              : 'Same order every round. Picks can be traded.'}
        </Text>
        {s.draftType === 'auction' ? (
          <>
            <View style={st.srow}>
              <Text style={st.slabel}>Auction budget ($)</Text>
              <NumberBox value={s.auctionBudget} editable={shape} onChange={(n) => set({ auctionBudget: Math.round(n) })} />
            </View>
            <Stepper label="BID CLOCK (SECONDS)" value={s.bidSeconds} min={5} max={120} step={5} onChange={any ? (n) => set({ bidSeconds: n }) : undefined} />
          </>
        ) : null}
        <Text style={st.lbl}>{s.draftType === 'auction' ? 'NOMINATION CLOCK' : 'PICK CLOCK'}</Text>
        {any ? (
          <Chips
            items={PICK_CLOCKS.map((n) => ({ id: String(n), label: n < 60 ? `${n}S` : `${n / 60}M` }))}
            value={String(s.pickSeconds)}
            onChange={(v) => set({ pickSeconds: Number(v) })}
          />
        ) : (
          <Text style={st.val}>{`${s.pickSeconds}s`}</Text>
        )}
      </Card>

      <Card>
        <CardHead title="KEEPERS & DYNASTY" note={s.keepers === 0 ? 'redraft' : s.keepers >= rosterSpots ? 'dynasty' : `${s.keepers} keeper${s.keepers === 1 ? '' : 's'}`} />
        {any ? (
          <Chips
            items={[
              { id: 'redraft', label: 'REDRAFT' },
              { id: 'keeper', label: 'KEEPERS' },
              { id: 'dynasty', label: 'DYNASTY' },
            ]}
            value={s.keepers === 0 ? 'redraft' : s.keepers >= rosterSpots ? 'dynasty' : 'keeper'}
            onChange={(v) =>
              set(
                v === 'redraft'
                  ? { keepers: 0, draftRounds: null }
                  : v === 'dynasty'
                    ? { keepers: rosterSpots, draftRounds: s.draftRounds ?? 3 }
                    : { keepers: Math.min(3, rosterSpots - 1), draftRounds: null }
              )
            }
          />
        ) : null}
        <Text style={st.note}>
          {s.keepers === 0
            ? 'Everyone starts fresh each season.'
            : s.keepers >= rosterSpots
              ? 'Teams keep their whole roster year to year; each new season has a short draft for new players.'
              : 'At the end of the season, each team keeps some players into next season; the draft is shorter by that many rounds.'}
        </Text>
        {s.keepers > 0 && s.keepers < rosterSpots ? (
          <Stepper label="KEEPERS PER TEAM" value={s.keepers} min={1} max={rosterSpots - 1} onChange={any ? (n) => set({ keepers: n }) : undefined} />
        ) : null}
        {s.keepers > 0 ? (
          <Stepper
            label="DRAFT ROUNDS AFTER YEAR ONE"
            hint={s.draftRounds == null ? 'Auto: roster minus keepers' : undefined}
            value={s.draftRounds ?? Math.max(1, rosterSpots - s.keepers)}
            min={1}
            max={rosterSpots}
            onChange={any ? (n) => set({ draftRounds: n }) : undefined}
          />
        ) : null}
      </Card>

      {h2h ? (
        <Card>
          <CardHead title="DIVISIONS" note={s.divisions.length ? `${s.divisions.length}` : 'none'} />
          {any ? (
            <Chips
              items={[0, 2, 3, 4].map((n) => ({ id: String(n), label: n ? String(n) : 'NONE' }))}
              value={String(s.divisions.length)}
              onChange={(v) => {
                const n = Number(v);
                const names = Array.from({ length: n }, (_, i) => s.divisions[i] ?? DIVISION_NAMES[i]);
                set({ divisions: names });
              }}
            />
          ) : null}
          {s.divisions.map((d, i) => (
            <View key={i} style={st.srow}>
              <Text style={st.slabel}>{`Division ${i + 1}`}</Text>
              <TextInput
                editable={any}
                style={[st.box, { width: 150, textAlign: 'left' }]}
                value={d}
                onChangeText={(v) => set({ divisions: s.divisions.map((x, j) => (j === i ? v : x)) })}
              />
            </View>
          ))}
          {s.divisions.length ? (
            <Text style={st.note}>Division winners get the top playoff seeds. The commissioner puts teams in divisions from Commissioner Tools.</Text>
          ) : null}
        </Card>
      ) : null}

      <Card>
        <CardHead title="WAIVERS & PICKUPS" />
        {any ? (
          <Chips
            items={[
              { id: 'rolling', label: 'ROLLING ORDER' },
              { id: 'faab', label: 'FAAB BIDS' },
              { id: 'none', label: 'FREE AGENTS ONLY' },
            ]}
            value={s.waivers.type}
            onChange={(v) => set({ waivers: { ...s.waivers, type: v } })}
          />
        ) : null}
        <Text style={st.note}>
          {s.waivers.type === 'rolling'
            ? 'Dropped players sit on waivers; the best-placed claim wins and goes to the back of the line.'
            : s.waivers.type === 'faab'
              ? 'Dropped players sit on waivers; highest blind bid wins, paid from a season budget.'
              : 'No waivers: anyone dropped can be picked up straight away.'}
        </Text>
        {s.waivers.type !== 'none' ? (
          <Stepper label="WAIVER DAYS" value={s.waivers.days} min={0} max={7} onChange={any ? (n) => set({ waivers: { ...s.waivers, days: n } }) : undefined} />
        ) : null}
        {s.waivers.type === 'faab' ? (
          <View style={st.srow}>
            <Text style={st.slabel}>FAAB budget ($)</Text>
            <NumberBox value={s.waivers.budget} editable={any} onChange={(n) => set({ waivers: { ...s.waivers, budget: Math.round(n) } })} />
          </View>
        ) : null}
        <Stepper
          label="ADDS PER WEEK"
          hint="0 = unlimited"
          value={s.maxAddsPerWeek}
          min={0}
          max={10}
          onChange={any ? (n) => set({ maxAddsPerWeek: n }) : undefined}
        />
      </Card>

      <Card>
        <CardHead title="TRADES" />
        {any ? (
          <Chips
            items={[
              { id: 'none', label: 'INSTANT' },
              { id: 'commissioner', label: 'COMMISSIONER' },
              { id: 'vote', label: 'LEAGUE VOTE' },
            ]}
            value={s.trades.review}
            onChange={(v) => set({ trades: { ...s.trades, review: v } })}
          />
        ) : null}
        <Text style={st.note}>
          {s.trades.review === 'none'
            ? 'Accepted trades go through straight away.'
            : s.trades.review === 'commissioner'
              ? 'The commissioner can approve or veto during the review window; after it, the trade goes through.'
              : 'Other teams can vote it down during the review window; enough votes vetoes it.'}
        </Text>
        {s.trades.review !== 'none' ? (
          <Stepper
            label="REVIEW HOURS"
            value={s.trades.reviewHours}
            min={0}
            max={72}
            step={12}
            onChange={any ? (n) => set({ trades: { ...s.trades, reviewHours: n } }) : undefined}
          />
        ) : null}
        {s.trades.review === 'vote' ? (
          <Stepper
            label="VETO VOTES NEEDED"
            value={s.trades.vetoVotes}
            min={1}
            max={Math.max(1, teams - 2)}
            onChange={any ? (n) => set({ trades: { ...s.trades, vetoVotes: n } }) : undefined}
          />
        ) : null}
        <View style={st.srow}>
          <Text style={st.slabel}>Trade deadline (YYYY-MM-DD)</Text>
          <TextInput
            editable={any}
            style={[st.box, { width: 120 }]}
            value={s.trades.deadline ?? ''}
            placeholder="none"
            placeholderTextColor={colors.textDim}
            onChangeText={(v) => set({ trades: { ...s.trades, deadline: v.trim() || null } })}
          />
        </View>
      </Card>
    </>
  );
}

const DRAFT_LABEL = { snake: 'Snake', linear: 'Same every round', auction: 'Auction' } as const;
const DIVISION_NAMES = ['North', 'South', 'East', 'West'];

function Stepper({
  label,
  hint,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange?: (n: number) => void;
}) {
  return (
    <View style={st.srow}>
      <View style={{ flex: 1 }}>
        <Text style={st.slabel}>{label}</Text>
        {hint ? <Text style={st.hint}>{hint}</Text> : null}
      </View>
      {onChange ? (
        <Pressable style={st.step} onPress={() => onChange(Math.max(min, value - step))}>
          <Text style={st.stepT}>−</Text>
        </Pressable>
      ) : null}
      <Text style={st.num}>{value}</Text>
      {onChange ? (
        <Pressable style={st.step} onPress={() => onChange(Math.min(max, value + step))}>
          <Text style={st.stepT}>+</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** A number field that keeps what you're typing ("-", "0.") until it's a number. */
function NumberBox({ value, onChange, editable }: { value: number; onChange: (n: number) => void; editable: boolean }) {
  const [text, setText] = React.useState(String(value));
  // Our own typing ("0.", "-") stays as typed; a change from outside (a preset) shows the new number.
  const shown = Number(text) === value ? text : String(value);
  return (
    <TextInput
      editable={editable}
      style={st.box}
      keyboardType="numbers-and-punctuation"
      value={shown}
      onChangeText={(t) => {
        setText(t);
        const n = Number(t);
        if (t.trim() !== '' && Number.isFinite(n)) onChange(n);
      }}
    />
  );
}

const st = themedStyles(() =>
  StyleSheet.create({
    val: { fontSize: 15, fontFamily: fonts.bodyMedium, color: colors.text, marginTop: 4 },
    note: { fontSize: 12, color: colors.textDim, fontFamily: fonts.body, marginTop: 8, lineHeight: 17 },
    lbl: { fontFamily: fonts.pixel, fontSize: 7.5, color: colors.textDim, letterSpacing: 1.2, marginTop: 14, marginBottom: 6 },
    srow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, gap: 10 },
    slabel: { flex: 1, fontSize: 13.5, fontFamily: fonts.bodyMedium, color: colors.text },
    hint: { fontSize: 11.5, color: colors.textDim, fontFamily: fonts.body, marginTop: 1 },
    num: { minWidth: 28, textAlign: 'center', fontFamily: fonts.pixel, fontSize: 11, color: colors.accent },
    step: { width: 34, height: 30, borderRadius: 8, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
    stepT: { fontSize: 18, color: colors.text, fontFamily: fonts.bodyMedium, marginTop: -2 },
    box: {
      width: 72,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingHorizontal: 8,
      paddingVertical: 6,
      color: colors.text,
      fontFamily: fonts.body,
      fontSize: 14,
      textAlign: 'right',
      backgroundColor: colors.surfaceAlt,
    },
    wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    cat: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
    catOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    catT: { fontFamily: fonts.pixel, fontSize: 8, color: colors.textMuted, letterSpacing: 0.5 },
    catTOn: { color: colors.onAccent },
  })
);
