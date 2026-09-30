import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useAuthSession } from '@/hooks/use-auth-session';

export default function AppTabs() {
  const { user, isLoading } = useAuthSession();
  const isAuthenticated = isLoading || Boolean(user);

  return (
    <NativeTabs
      backgroundColor="#FFFFFF"
      indicatorColor="#E8F1EB"
      iconColor={{ default: '#9CA3AF', selected: '#1B5E3B' }}
      labelStyle={{
        default: { color: '#6B7280', fontSize: 11, fontWeight: '600' },
        selected: { color: '#1B5E3B', fontSize: 11, fontWeight: '700' },
      }}
      labelVisibilityMode="labeled"
      rippleColor="#E8E9EB"
      tintColor="#1B5E3B"
    >
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'house', selected: 'house.fill' }}
          md={{ default: 'home', selected: 'home' }}
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="camera">
        <NativeTabs.Trigger.Label>Scan</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'camera', selected: 'camera.fill' }}
          md={{ default: 'camera_alt', selected: 'camera_alt' }}
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="reports">
        <NativeTabs.Trigger.Label>Reports</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'doc.text', selected: 'doc.text.fill' }}
          md={{ default: 'description', selected: 'description' }}
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="explore">
        <NativeTabs.Trigger.Label>Explore</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'safari', selected: 'safari.fill' }}
          md={{ default: 'explore', selected: 'explore' }}
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name={isAuthenticated ? "profile" : "login"}>
        <NativeTabs.Trigger.Label>
          {isAuthenticated ? "Profile" : "Login"}
        </NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'person.crop.circle', selected: 'person.crop.circle.fill' }}
          md={{ default: 'person', selected: 'person' }}
        />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
