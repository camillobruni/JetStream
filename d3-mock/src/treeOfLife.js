class TreeOfLife {
  static color = d3
    .scaleOrdinal()
    .domain(["Bacteria", "Eukaryota", "Archaea"])
    .range(d3.schemeCategory10);

  constructor(dataTxt) {
    this.width = 954;
    this.outerRadius = this.width / 2;
    this.innerRadius = this.outerRadius - 170;
    this.data = this.parseNewick(dataTxt);
  }

  static setRadius(d, y0, k) {
    d.radius = (y0 += d.data.length) * k;
    d.children?.forEach((d) => TreeOfLife.setRadius(d, y0, k));
  }

  cluster() {
    return d3
      .cluster()
      .size([360, this.innerRadius])
      .separation((a, b) => 1);
  }

  static maxLength(d) {
    return (
      d.data.length +
      (d.children ? d3.max(d.children, TreeOfLife.maxLength) : 0)
    );
  }

  static setColor(d) {
    var name = d.data.name;
    d.color =
      TreeOfLife.color.domain().indexOf(name) >= 0
        ? TreeOfLife.color(name)
        : d.parent
        ? d.parent.color
        : null;
    d.children?.forEach(TreeOfLife.setColor);
  }

  linkVariable(d) {
    return this.linkStep(
      d.source.x,
      d.source.radius,
      d.target.x,
      d.target.radius
    );
  }

  linkConstant(d) {
    return this.linkStep(d.source.x, d.source.y, d.target.x, d.target.y);
  }

  linkExtensionVariable(d) {
    return this.linkStep(
      d.target.x,
      d.target.radius,
      d.target.x,
      this.innerRadius
    );
  }

  linkExtensionConstant(d) {
    return this.linkStep(d.target.x, d.target.y, d.target.x, this.innerRadius);
  }

  linkStep(startAngle, startRadius, endAngle, endRadius) {
    const c0 = Math.cos((startAngle = ((startAngle - 90) / 180) * Math.PI));
    const s0 = Math.sin(startAngle);
    const c1 = Math.cos((endAngle = ((endAngle - 90) / 180) * Math.PI));
    const s1 = Math.sin(endAngle);
    return (
      "M" +
      startRadius * c0 +
      "," +
      startRadius * s0 +
      (endAngle === startAngle
        ? ""
        : "A" +
          startRadius +
          "," +
          startRadius +
          " 0 0 " +
          (endAngle > startAngle ? 1 : 0) +
          " " +
          startRadius * c1 +
          "," +
          startRadius * s1) +
      "L" +
      endRadius * c1 +
      "," +
      endRadius * s1
    );
  }

  legend(svg) {
    const g = svg
      .selectAll("g")
      .data(TreeOfLife.color.domain())
      .join("g")
      .attr(
        "transform",
        (d, i) =>
          `translate(${-this.outerRadius},${-this.outerRadius + i * 20})`
      );

    g.append("rect")
      .attr("width", 18)
      .attr("height", 18)
      .attr("fill", TreeOfLife.color);

    g.append("text")
      .attr("x", 24)
      .attr("y", 9)
      .attr("dy", "0.35em")
      .text((d) => d);
  }

  // https://github.com/jasondavies/newick.js
  parseNewick(a) {
    for (
      var e = [], r = {}, s = a.split(/\s*(;|\(|\)|,|:)\s*/), t = 0;
      t < s.length;
      t++
    ) {
      var n = s[t];
      switch (n) {
        case "(":
          var c = {};
          (r.branchset = [c]), e.push(r), (r = c);
          break;
        case ",":
          var c = {};
          e[e.length - 1].branchset.push(c), (r = c);
          break;
        case ")":
          r = e.pop();
          break;
        case ":":
          break;
        default:
          var h = s[t - 1];
          ")" == h || "(" == h || "," == h
            ? (r.name = n)
            : ":" == h && (r.length = parseFloat(n));
      }
    }
    return r;
  }

  render() {
    const root = d3
      .hierarchy(this.data, (d) => d.branchset)
      .sum((d) => (d.branchset ? 0 : 1))
      .sort(
        (a, b) =>
          a.value - b.value || d3.ascending(a.data.length, b.data.length)
      );

    this.cluster(root);
    TreeOfLife.setRadius(
      root,
      (root.data.length = 0),
      this.innerRadius / TreeOfLife.maxLength(root)
    );
    TreeOfLife.setColor(root);

    const mockDocument = new Document();
    const body = d3.select(mockDocument.body);
    const svg = body.append("svg");

    svg
      .attr("viewBox", [
        -this.outerRadius,
        -this.outerRadius,
        this.width,
        this.width,
      ])
      .attr("font-family", "sans-serif")
      .attr("font-size", 10);

    svg.append("g").call(this.legend.bind(this));

    svg.append("style").text(`
      .link--active {
        stroke: #000 !important;
        stroke-width: 1.5px;
      }

      .link-extension--active {
        stroke-opacity: .6;
      }

      .label--active {
        font-weight: bold;
      }`);

    const linkExtension = svg
      .append("g")
      .attr("fill", "none")
      .attr("stroke", "#000")
      .attr("stroke-opacity", 0.25)
      .selectAll("path")
      .data(root.links().filter((d) => !d.target.children))
      .join("path")
      .each((d) => (d.target.linkExtensionNode = this))
      .attr("d", this.linkExtensionConstant.bind(this));

    const link = svg
      .append("g")
      .attr("fill", "none")
      .attr("stroke", "#000")
      .selectAll("path")
      .data(root.links())
      .join("path")
      .each((d) => (d.target.linkNode = this))
      .attr("d", this.linkConstant.bind(this))
      .attr("stroke", (d) => d.target.color);

    svg
      .append("g")
      .selectAll("text")
      .data(root.leaves())
      .join("text")
      .attr("dy", ".31em")
      .attr(
        "transform",
        (d) =>
          `rotate(${d.x - 90}) translate(${this.innerRadius + 4},0)${
            d.x < 180 ? "" : " rotate(180)"
          }`
      )
      .attr("text-anchor", (d) => (d.x < 180 ? "start" : "end"))
      .text((d) => d.data.name.replace(/_/g, " "))
      .on("mouseover", onMouseOver(true))
      .on("mouseout", onMouseOver(false));

    function update(checked) {
      const t = d3.transition().duration(750);
      linkExtension
        .transition(t)
        .attr(
          "d",
          checked
            ? this.linkExtensionVariable.bind(this)
            : this.linkExtensionConstant.bind(this)
        );
      link
        .transition(t)
        .attr(
          "d",
          checked ? this.linkVariable.bind(this) : this.linkConstant.bind(this)
        );
    }

    function onMouseOver(active) {
      return (event, d) => {
        d3.select(this).classed("label--active", active);
        d3.select(d.linkExtensionNode)
          .classed("link-extension--active", active)
          .raise();
        do {
          d3.select(d.linkNode).classed("link--active", active).raise();
        } while ((d = d.parent));
      };
    }

    return Object.assign(svg.node(), { update });
  }
}

function d3TreeOfLife(data) {
  return new TreeOfLife(data).render();
}
