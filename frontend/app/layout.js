import "./globals.css";
import AssistantWidget from "../components/AssistantWidget";

export const metadata = {
  title: "Pathwise — Learning Path Recommender",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
        <AssistantWidget />
      </body>
    </html>
  );
}
