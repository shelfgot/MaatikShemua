"""Line ordering service for RTL manuscripts."""
from typing import List, Dict


def get_line_center_x(line: Dict) -> float:
    """Get x-coordinate of line center from baseline."""
    baseline = line.get('baseline', [])
    if not baseline:
        return 0
    xs = [p[0] for p in baseline]
    return sum(xs) / len(xs)


def get_line_y(line: Dict) -> float:
    """Get y-coordinate for sorting (top of line)."""
    boundary = line.get('boundary', [])
    if boundary:
        return min(p[1] for p in boundary)
    baseline = line.get('baseline', [])
    if baseline:
        return min(p[1] for p in baseline)
    return 0


def get_line_bounds(line: Dict) -> Dict:
    """Get bounding rectangle of a line."""
    boundary = line.get('boundary', []) or line.get('baseline', [])
    if not boundary:
        return {"x1": 0, "y1": 0, "x2": 0, "y2": 0}
    
    xs = [p[0] for p in boundary]
    ys = [p[1] for p in boundary]
    
    return {
        "x1": min(xs),
        "y1": min(ys),
        "x2": max(xs),
        "y2": max(ys),
    }


def cluster_lines_by_column(lines: List[Dict], threshold: float = 0.1) -> List[List[Dict]]:
    """Cluster lines into columns based on x-coordinate proximity."""
    if not lines:
        return []
    
    # Get image width estimate from rightmost point
    all_x = []
    for line in lines:
        boundary = line.get('boundary', []) or line.get('baseline', [])
        all_x.extend([p[0] for p in boundary])
    
    if not all_x:
        return [lines]
    
    image_width = max(all_x)
    threshold_px = threshold * image_width
    
    # Sort by x-coordinate of line center
    sorted_lines = sorted(lines, key=lambda l: get_line_center_x(l))
    
    columns = []
    current_column = [sorted_lines[0]]
    
    for line in sorted_lines[1:]:
        prev_x = get_line_center_x(current_column[-1])
        curr_x = get_line_center_x(line)
        
        # If x-distance is small, same column
        if abs(curr_x - prev_x) < threshold_px:
            current_column.append(line)
        else:
            columns.append(current_column)
            current_column = [line]
    
    columns.append(current_column)
    return columns


def reorder_lines_for_rtl(lines: List[Dict]) -> List[Dict]:
    """Reorder lines for RTL reading (right column first)."""
    if not lines:
        return lines
    
    # Group lines by column
    columns = cluster_lines_by_column(lines)
    
    # Sort columns right-to-left (by rightmost x of column)
    def get_column_x(column: List[Dict]) -> float:
        centers = [get_line_center_x(line) for line in column]
        return max(centers) if centers else 0
    
    sorted_columns = sorted(columns, key=get_column_x, reverse=True)
    
    # Flatten, keeping top-to-bottom within each column
    reordered = []
    for column in sorted_columns:
        column_sorted = sorted(column, key=get_line_y)
        reordered.extend(column_sorted)
    
    # Assign display_order
    for i, line in enumerate(reordered):
        line['display_order'] = i
    
    return reordered


def reorder_lines_for_ltr(lines: List[Dict]) -> List[Dict]:
    """Reorder lines for LTR reading (left column first)."""
    if not lines:
        return lines
    
    # Group lines by column
    columns = cluster_lines_by_column(lines)
    
    # Sort columns left-to-right
    def get_column_x(column: List[Dict]) -> float:
        centers = [get_line_center_x(line) for line in column]
        return min(centers) if centers else 0
    
    sorted_columns = sorted(columns, key=get_column_x)
    
    # Flatten, keeping top-to-bottom within each column
    reordered = []
    for column in sorted_columns:
        column_sorted = sorted(column, key=get_line_y)
        reordered.extend(column_sorted)
    
    # Assign display_order
    for i, line in enumerate(reordered):
        line['display_order'] = i
    
    return reordered


def apply_manual_order(lines: List[Dict], order: List[int]) -> List[Dict]:
    """Apply manual ordering to lines."""
    if len(order) != len(lines):
        # If order doesn't match, return original
        return lines
    
    # Create mapping from old index to new position
    reordered = [None] * len(lines)
    for new_pos, old_idx in enumerate(order):
        if 0 <= old_idx < len(lines):
            reordered[new_pos] = lines[old_idx].copy()
            reordered[new_pos]['display_order'] = new_pos
    
    # Filter out any None values
    return [l for l in reordered if l is not None]
