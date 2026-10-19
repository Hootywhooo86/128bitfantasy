import { router } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';

/**
 * bitfantasy://auth-callback: 128bit family sign-in (Google / Apple) coming back.
 * The in-app browser session in lib/family.ts already has the code; this route
 * only keeps the router from showing "not found" when Android also delivers it.
 */
export default function FamilyAuthCallback() {
  useEffect(() => {
    router.replace('/settings/family');
  }, []);
  return <View />;
}
