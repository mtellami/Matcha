import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import "@heroui/react/styles";
import { ThemeProvider } from "./shared/theme";
import { createBrowserRouter, RouterProvider } from "react-router";

const router = createBrowserRouter([
  {
    path: "*",
    element: (
      <ThemeProvider defaultTheme="dark">
        <App />
      </ThemeProvider>
    ),
  },
]);

createRoot(document.getElementById("root")!).render(
  <RouterProvider router={router} />,
);
