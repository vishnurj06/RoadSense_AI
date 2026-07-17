/**
 * Filters.test.jsx
 *
 * Component tests for src/components/shared/Filters.js
 *
 * Tests that severity toggles, class filter, and status dropdown
 * render correctly and call their handlers.
 *
 * KEY CONTRACT v3 TEST: passing a `knownClasses` array that includes
 * a future class (e.g. "speed_breaker") must render without crashing.
 */
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import Filters from "@/components/shared/Filters";

function renderFilters(overrides = {}) {
  const defaultProps = {
    severityFilter: { high: true, medium: true, low: true },
    setSeverityFilter: jest.fn(),
    classFilter: "all",
    setClassFilter: jest.fn(),
    statusFilter: "all",
    setStatusFilter: jest.fn(),
    knownClasses: ["pothole", "road_crack"],
    ...overrides,
  };
  return { ...render(<Filters {...defaultProps} />), props: defaultProps };
}

describe("Filters", () => {
  test("renders the filters panel", () => {
    renderFilters();
    expect(screen.getByTestId("filters-panel")).toBeInTheDocument();
  });

  test("renders all three severity toggle buttons", () => {
    renderFilters();
    expect(screen.getByTestId("severity-toggle-high")).toBeInTheDocument();
    expect(screen.getByTestId("severity-toggle-medium")).toBeInTheDocument();
    expect(screen.getByTestId("severity-toggle-low")).toBeInTheDocument();
  });

  test("calls setSeverityFilter when a severity toggle is clicked", () => {
    const { props } = renderFilters();
    fireEvent.click(screen.getByTestId("severity-toggle-high"));
    expect(props.setSeverityFilter).toHaveBeenCalledTimes(1);
  });

  test("renders 'All Hazards' and all knownClasses buttons", () => {
    renderFilters({ knownClasses: ["pothole", "road_crack"] });
    expect(screen.getByTestId("class-filter-all")).toBeInTheDocument();
    expect(screen.getByTestId("class-filter-pothole")).toBeInTheDocument();
    expect(screen.getByTestId("class-filter-road_crack")).toBeInTheDocument();
  });

  test("Contract v3: renders new future classes without crashing", () => {
    // Simulates A shipping speed_breaker before B explicitly handles it
    expect(() =>
      renderFilters({ knownClasses: ["pothole", "road_crack", "speed_breaker", "future_x"] })
    ).not.toThrow();
    expect(screen.getByTestId("class-filter-speed_breaker")).toBeInTheDocument();
    expect(screen.getByTestId("class-filter-future_x")).toBeInTheDocument();
  });

  test("calls setClassFilter with 'pothole' when pothole button is clicked", () => {
    const { props } = renderFilters();
    fireEvent.click(screen.getByTestId("class-filter-pothole"));
    expect(props.setClassFilter).toHaveBeenCalledWith("pothole");
  });

  test("renders status dropdown with 'All Statuses' as default", () => {
    renderFilters();
    const select = screen.getByTestId("status-filter-select");
    expect(select).toBeInTheDocument();
    expect(select.value).toBe("all");
  });

  test("calls setStatusFilter on dropdown change", () => {
    const { props } = renderFilters();
    fireEvent.change(screen.getByTestId("status-filter-select"), {
      target: { value: "approved" },
    });
    expect(props.setStatusFilter).toHaveBeenCalledWith("approved");
  });
});
