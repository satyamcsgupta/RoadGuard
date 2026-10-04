import {
  Tabs,
  TabList,
  TabTrigger,
  TabSlot,
  TabTriggerSlotProps,
  TabListProps,
} from 'expo-router/ui';
import type { Href } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const tabIcons = {
  home: { ios: 'house.fill', android: 'home', web: 'home' },
  scan: { ios: 'camera.fill', android: 'camera_alt', web: 'camera_alt' },
  reports: { ios: 'doc.text.fill', android: 'description', web: 'description' },
  login: { ios: 'person.crop.circle', android: 'person', web: 'person' },
  profile: { ios: 'person.crop.circle', android: 'person', web: 'person' },
} as const;

export default function AppTabs() {
  return (
    <Tabs options={{ initialRouteName: 'index' }}>
      <TabSlot style={{ height: '100%', paddingBottom: 76 }} />
      <TabList asChild>
        <CustomTabList>
          <TabTrigger name="home" href={'/(app)/(tabs)/index' as Href} asChild>
            <TabButton icon="home">Home</TabButton>
          </TabTrigger>
          <TabTrigger name="camera" href={'/(app)/(tabs)/camera' as Href} asChild>
            <TabButton icon="scan">Scan</TabButton>
          </TabTrigger>
          <TabTrigger name="reports" href={'/(app)/(tabs)/reports' as Href} asChild>
            <TabButton icon="reports">Reports</TabButton>
          </TabTrigger>
          <TabTrigger name="profile" href={'/(app)/(tabs)/profile' as Href} asChild>
            <TabButton icon="profile">Profile</TabButton>
          </TabTrigger>
        </CustomTabList>
      </TabList>
    </Tabs>
  );
}

type TabButtonProps = TabTriggerSlotProps & { icon: keyof typeof tabIcons };

export function TabButton({ children, isFocused, icon, ...props }: TabButtonProps) {
  return (
    <Pressable
      {...props}
      accessibilityRole="tab"
      style={({ pressed }) => [styles.tabButton, pressed && styles.pressed]}
    >
      <SymbolView
        name={tabIcons[icon]}
        size={20}
        tintColor={isFocused ? '#1B5E3B' : '#9CA3AF'}
      />
      <Text style={[styles.tabLabel, isFocused && styles.tabLabelSelected]}>
        {children}
      </Text>
    </Pressable>
  );
}

export function CustomTabList(props: TabListProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      {...props}
      style={[styles.tabListContainer, { paddingBottom: Math.max(insets.bottom, 8) }, props.style]}
    >
      {props.children}
    </View>
  );
}

const styles = StyleSheet.create({
  tabListContainer: {
    position: 'absolute',
    bottom: 0,
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingTop: 8,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E8E9EB',
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minHeight: 56,
  },
  tabLabel: {
    color: '#9CA3AF',
    fontSize: 11,
    fontWeight: '600',
  },
  tabLabelSelected: {
    color: '#1B5E3B',
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.72,
  },
});
