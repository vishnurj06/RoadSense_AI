/**
 * StatCards.test.jsx
 *
 * Component tests for src/components/shared/StatCards.js
 *
 * Tests that the stat display is correct for given analytics props,
 * and that missing/null props don't crash the component.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import StatCards from "@/components/shared/StatCards";

const mockAnalytics = {
  total_reports: 42,
  total_detections: 137,
  severity_distribution: { high: 7, medium: 21, low: 14 },
};

describe("StatCards", () => {
  test("renders the three stat tiles", () => {
    render(<StatCards analytics={mockAnalytics} />);
    expect(screen.getByTestId("stat-cards")).toBeInTheDocument();
  });

  test("displays correct report count", () => {
    render(<StatCards analytics={mockAnalytics} />);
    expect(screen.getByTestId("stat-reports")).toHaveTextContent("42");
  });

  test("displays correct detection count", () => {
    render(<StatCards analytics={mockAnalytics} />);
    expect(screen.getByTestId("stat-detections")).toHaveTextContent("137");
  });

  test("displays correct high-risk count", () => {
    render(<StatCards analytics={mockAnalytics} />);
    expect(screen.getByTestId("stat-high-risk")).toHaveTextContent("7");
  });

  test("renders zeros gracefully when analytics is empty object", () => {
    render(<StatCards analytics={{}} />);
    expect(screen.getByTestId("stat-reports")).toHaveTextContent("0");
    expect(screen.getByTestId("stat-detections")).toHaveTextContent("0");
    expect(screen.getByTestId("stat-high-risk")).toHaveTextContent("0");
  });

  test("does not throw when analytics is null", () => {
    expect(() => render(<StatCards analytics={null} />)).not.toThrow();
  });
});
