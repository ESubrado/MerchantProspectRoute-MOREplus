import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" {...props}>
      {children}
    </svg>
  );
}

export function BrandMark(props: IconProps) {
  return (
    <svg aria-label="SurnMore" fill="none" role="img" viewBox="0 0 32 32" {...props}>
      <rect fill="#E8F1F9" height="28" rx="8" width="28" x="2" y="2" />
      <path d="M23.2 9.2c-1.8-1.5-4-2.2-6.7-2.2-3.9 0-6.6 1.6-6.6 4.4 0 6.1 12.3 2.5 12.3 8 0 2.8-2.6 4.6-6.6 4.6-2.9 0-5.4-.9-7.1-2.6" stroke="#1E5D95" strokeWidth="3" />
      <path d="M21.5 8.1 24.7 8.1 24.7 11.3" stroke="#08776E" strokeWidth="2" />
    </svg>
  );
}

export function HomeIcon(props: IconProps) {
  return <Icon {...props}><path d="m3 10 9-7 9 7v10.5a.5.5 0 0 1-.5.5H15v-6H9v6H3.5a.5.5 0 0 1-.5-.5V10Z" /></Icon>;
}

export function UsersIcon(props: IconProps) {
  return <Icon {...props}><path d="M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1" /><circle cx="9.5" cy="7" r="3" /><path d="M21 20v-1.2a4 4 0 0 0-3-3.85M16.5 4.2a3 3 0 0 1 0 5.6" /></Icon>;
}

export function UserIcon(props: IconProps) {
  return <Icon {...props}><circle cx="12" cy="8" r="3.5" /><path d="M5 21a7 7 0 0 1 14 0" /></Icon>;
}

export function TargetIcon(props: IconProps) {
  return <Icon {...props}><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="3" /><path d="M12 3.5V1.8M20.5 12h1.7M12 20.5v1.7M3.5 12H1.8" /></Icon>;
}

export function InboxIcon(props: IconProps) {
  return <Icon {...props}><path d="M4 5.5h16l1.5 10.8a2 2 0 0 1-2 2.2h-15a2 2 0 0 1-2-2.2L4 5.5Z" /><path d="M3 14h5l1.4 2h5.2l1.4-2h5" /></Icon>;
}

export function SettingsIcon(props: IconProps) {
  return <Icon {...props}><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1 1.7-2.2 2.2-1.7-.1-1.1 1.2-2.9-1.2V17l-1.6-.7-1.4 1-2.4-2 .7-1.6-.7-1.5-1.7-.2V9.1l1.7-.2.7-1.5-.7-1.6 2.4-2 1.4 1 1.6-.7V2.4l2.9-1.2 1.1 1.2 1.7-.1 2.2 2.2-.1 1.7 1.2 1.1-1.2 2.9h-1.7l-.7 1.6.7 1.4Z" /></Icon>;
}

export function LogOutIcon(props: IconProps) {
  return <Icon {...props}><path d="M14 4H5.5A1.5 1.5 0 0 0 4 5.5v13A1.5 1.5 0 0 0 5.5 20H14" /><path d="m11 12 8-5v10l-8-5ZM19 12h-8" /></Icon>;
}

export function BuildingIcon(props: IconProps) {
  return <Icon {...props}><path d="M4 21V5.5a1.5 1.5 0 0 1 1.5-1.5h9A1.5 1.5 0 0 1 16 5.5V21" /><path d="M16 9h2.5A1.5 1.5 0 0 1 20 10.5V21M8 8h4M8 12h4M8 16h4M2 21h20" /></Icon>;
}

export function LayersIcon(props: IconProps) {
  return <Icon {...props}><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5M3 16l9 5 9-5" /></Icon>;
}

export function ChevronDownIcon(props: IconProps) {
  return <Icon {...props}><path d="m6 9 6 6 6-6" /></Icon>;
}

export function PanelLeftIcon(props: IconProps) {
  return <Icon {...props}><rect height="17" rx="2" width="19" x="2.5" y="3.5" /><path d="M9 3.5v17M13 9l3 3-3 3" /></Icon>;
}

export function SearchIcon(props: IconProps) {
  return <Icon {...props}><circle cx="10.8" cy="10.8" r="6.3" /><path d="m16 16 4.3 4.3" /></Icon>;
}

export function SlidersIcon(props: IconProps) {
  return <Icon {...props}><path d="M4 7h16M4 17h16M8 7v5M16 12v5" /></Icon>;
}

export function PlusIcon(props: IconProps) {
  return <Icon {...props}><path d="M12 5v14M5 12h14" /></Icon>;
}

export function CloseIcon(props: IconProps) {
  return <Icon {...props}><path d="m6 6 12 12M18 6 6 18" /></Icon>;
}

export function ArrowUpRightIcon(props: IconProps) {
  return <Icon {...props}><path d="M7 17 17 7M9 7h8v8" /></Icon>;
}

export function MoreIcon(props: IconProps) {
  return <Icon {...props}><circle cx="5" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="19" cy="12" r="1" fill="currentColor" /></Icon>;
}
