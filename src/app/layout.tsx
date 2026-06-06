import type {Metadata} from 'next';
import './styles.css';

export const metadata: Metadata = {
  title: 'PlotTeaFiles Studio',
  description: 'Generate cinematic PlotTeaFiles short-form story videos.'
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
