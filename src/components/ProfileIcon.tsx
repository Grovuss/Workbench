import logo from '../assets/logo.svg';
import type { Profile } from '../types';

/** The profile's custom icon, or the Workbench mark on a tile. */
export default function ProfileIcon({ profile, className }: { profile: Profile; className: string }) {
  return (
    <div className={className} data-custom={profile.icon ? true : undefined}>
      {profile.icon ? (
        <img src={`workbench://profile-icon/${profile.id}?v=${encodeURIComponent(profile.icon)}`} alt="" />
      ) : (
        <img src={logo} alt="" />
      )}
    </div>
  );
}
