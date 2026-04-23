import Image from "next/image";
import { cn } from "@/lib/utils";

interface PhoneFrameProps {
  src: string;
  alt: string;
  className?: string;
  priority?: boolean;
}

/**
 * Rámeček telefonu se screenshotem. Zachovává poměr stran 9:19.5 (moderní Android).
 * Screenshoty dodané jako 1280×2800 px, Next.js je automaticky převede na WebP.
 */
export function PhoneFrame({ src, alt, className, priority }: PhoneFrameProps) {
  return (
    <div
      className={cn(
        "relative inline-block rounded-[2rem] bg-ink-900 p-[6px] shadow-2xl ring-1 ring-black/10",
        className,
      )}
    >
      <div className="relative overflow-hidden rounded-[1.6rem] bg-black" style={{ width: "280px", aspectRatio: "9 / 19.5" }}>
        <Image
          src={src}
          alt={alt}
          fill
          sizes="280px"
          priority={priority}
          className="object-cover"
        />
      </div>
    </div>
  );
}
