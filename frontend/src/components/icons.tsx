import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function IconBase({ size = 16, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      width={size}
      height={size}
      {...rest}
    >
      {children}
    </svg>
  );
}

export const Icon = {
  search: (p: IconProps) => (
    <IconBase {...p}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4.3-4.3" />
    </IconBase>
  ),
  refresh: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M3 12a9 9 0 0 1 15.5-6.3L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.5 6.3L3 16M3 21v-5h5" />
    </IconBase>
  ),
  export: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5-5 5 5M12 5v12" />
    </IconBase>
  ),
  finding: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M12 2l10 5v5c0 5-4 9-10 10-6-1-10-5-10-10V7z" />
      <path d="M12 8v4M12 16h0" />
    </IconBase>
  ),
};

export default Icon;
