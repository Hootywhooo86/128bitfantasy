import { useRouter } from 'expo-router';
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { TopBar } from '@/components/TopBar';
import { useAccent } from '@/lib/accent';
import { CONTENT_MAX_WIDTH, colors, fonts, radius, spacing, themedStyles } from '@/lib/theme';

/**
 * The building blocks, same classes as 128BIT FIT's shell. Screens are put
 * together from these rather than styled one by one.
 */

export function Screen({
  section,
  children,
  back,
  right,
  onRefresh,
  refreshing = false,
}: {
  section: string;
  children: React.ReactNode;
  back?: boolean;
  right?: 'gear' | 'none';
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const router = useRouter();
  // Keyed on the accent so a colour change repaints the screen's content
  // without resetting navigation.
  const accent = useAccent();
  return (
    <View style={s.screen}>
      <TopBar
        section={section}
        right={right}
        onBack={back ? () => (router.canGoBack() ? router.back() : router.replace('/')) : undefined}
      />
      <ScrollView
        key={accent}
        style={s.screen}
        contentContainerStyle={s.main}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.textMuted}
              colors={[colors.accent]}
              progressBackgroundColor={colors.surface}
            />
          ) : undefined
        }
      >
        {children}
      </ScrollView>
    </View>
  );
}

export function Label({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return (
    <View style={[s.lblWrap, style]}>
      <Text style={s.lbl}>{children}</Text>
    </View>
  );
}

export function Card({ children, style, onPress }: { children: React.ReactNode; style?: ViewStyle; onPress?: () => void }) {
  if (onPress) {
    return (
      <Pressable style={({ pressed }) => [s.card, pressed && s.pressed, style]} onPress={onPress}>
        {children}
      </Pressable>
    );
  }
  return <View style={[s.card, style]}>{children}</View>;
}

export function CardHead({ title, note }: { title: string; note?: string }) {
  return (
    <View style={s.ch}>
      <Text style={s.chT}>{title}</Text>
      {note ? <Text style={s.chS}>{note}</Text> : null}
    </View>
  );
}

export function MenuRow({
  icon,
  name,
  sub,
  value,
  onPress,
}: {
  icon?: string;
  name: string;
  sub?: string;
  value?: string;
  onPress?: () => void;
}) {
  return (
    <Pressable style={({ pressed }) => [s.mrow, pressed && s.pressed]} onPress={onPress}>
      {icon ? <Text style={s.mrowIc}>{icon}</Text> : null}
      <View style={s.mrowTx}>
        <Text style={s.mrowN} numberOfLines={1}>{name}</Text>
        {sub ? <Text style={s.mrowS}>{sub}</Text> : null}
      </View>
      {value ? <Text style={s.mrowV}>{value}</Text> : null}
      <Text style={s.mrowA}>›</Text>
    </Pressable>
  );
}

export function Button({
  label,
  onPress,
  kind = 'primary',
  busy = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'ghost' | 'danger';
  busy?: boolean;
  disabled?: boolean;
}) {
  const off = disabled || busy;
  return (
    <Pressable
      style={({ pressed }) => [s.btn, kind === 'ghost' && s.btnGhost, kind === 'danger' && s.btnDanger, (pressed || off) && { opacity: 0.7 }]}
      onPress={off ? undefined : onPress}
      accessibilityRole="button"
    >
      {busy ? (
        <ActivityIndicator color={kind === 'primary' ? colors.onAccent : colors.text} />
      ) : (
        <Text style={[s.btnT, kind !== 'primary' && s.btnTGhost]}>{label}</Text>
      )}
    </Pressable>
  );
}

export function Chips<T extends string>({
  items,
  value,
  onChange,
}: {
  items: { id: T; label: string; count?: number }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={s.chips}>
      {items.map((it) => {
        const on = it.id === value;
        return (
          <Pressable key={it.id} style={[s.chip, on && s.chipOn]} onPress={() => onChange(it.id)}>
            <Text style={[s.chipT, on && s.chipTOn]}>
              {it.label}
              {it.count != null ? ` ${it.count}` : ''}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Field({ label, hint, ...props }: TextInputProps & { label: string; hint?: string }) {
  return (
    <View style={s.field}>
      <Text style={s.fieldL}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.textDim}
        autoCapitalize="none"
        autoCorrect={false}
        style={[s.input, props.multiline && { minHeight: 80, textAlignVertical: 'top' }]}
        {...props}
      />
      {hint ? <Text style={s.fieldH}>{hint}</Text> : null}
    </View>
  );
}

export function Note({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'error' }) {
  return (
    <View style={[s.note, tone === 'error' && { borderLeftColor: colors.danger }]}>
      <Text style={[s.noteT, tone === 'error' && { color: colors.danger }]}>{children}</Text>
    </View>
  );
}

/** An empty state that says what to do next instead of showing zeros. */
export function Empty({ title, body, action }: { title: string; body: string; action?: { label: string; onPress: () => void } }) {
  return (
    <Card style={{ alignItems: 'center', paddingVertical: 28 }}>
      <Text style={s.emptyT}>{title}</Text>
      <Text style={s.emptyB}>{body}</Text>
      {action ? (
        <View style={{ alignSelf: 'stretch', marginTop: 16 }}>
          <Button label={action.label} onPress={action.onPress} />
        </View>
      ) : null}
    </Card>
  );
}

export const s = themedStyles(() => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  main: { padding: spacing.md, paddingBottom: 48, width: '100%', maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center' },
  lblWrap: { marginTop: spacing.lg, marginBottom: 10 },
  lbl: { fontFamily: fonts.pixel, fontSize: 8, color: colors.textDim, letterSpacing: 1.5 },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: 10,
  },
  pressed: { borderColor: colors.borderBright },
  ch: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 13 },
  chT: { fontFamily: fonts.pixel, fontSize: 9, letterSpacing: 1, color: colors.text },
  chS: { fontSize: 12, color: colors.textMuted, fontFamily: fonts.body },
  mrow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingVertical: 15,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  mrowIc: { width: 26, textAlign: 'center', fontSize: 15, color: colors.textMuted },
  mrowTx: { flex: 1, minWidth: 0 },
  mrowN: { fontSize: 15, fontFamily: fonts.bodySemi, color: colors.text, lineHeight: 20 },
  mrowS: { fontSize: 12.5, color: colors.textDim, marginTop: 5, lineHeight: 18, fontFamily: fonts.body },
  mrowV: { fontSize: 12.5, color: colors.textMuted, fontFamily: fonts.body },
  mrowA: { color: colors.textDim, fontSize: 16 },
  btn: { backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', marginTop: 6 },
  btnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.borderBright },
  btnDanger: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.danger },
  btnT: { fontFamily: fonts.pixel, fontSize: 10, color: colors.onAccent, letterSpacing: 1 },
  btnTGhost: { color: colors.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipT: { fontFamily: fonts.pixel, fontSize: 8.5, color: colors.textMuted, letterSpacing: 1 },
  chipTOn: { color: colors.onAccent },
  field: { marginBottom: 14 },
  fieldL: { fontFamily: fonts.pixel, fontSize: 8, color: colors.textDim, letterSpacing: 1.5, marginBottom: 7 },
  input: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: 15,
  },
  fieldH: { fontSize: 12, color: colors.textDim, marginTop: 6, lineHeight: 17, fontFamily: fonts.body },
  note: { borderLeftWidth: 2, borderLeftColor: colors.borderBright, paddingLeft: 11, marginVertical: 8 },
  noteT: { fontSize: 12.5, color: colors.textMuted, lineHeight: 21, fontFamily: fonts.body },
  emptyT: { fontFamily: fonts.pixel, fontSize: 11, color: colors.text, letterSpacing: 1, textAlign: 'center' },
  emptyB: { fontSize: 13, color: colors.textMuted, marginTop: 10, lineHeight: 20, textAlign: 'center', fontFamily: fonts.body },
}));
